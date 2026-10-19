import os
import re
from datetime import datetime

import numpy as np
import torch

from PIL import Image
from sentence_transformers import SentenceTransformer
from transformers import CLIPModel, CLIPProcessor
from sklearn.cluster import DBSCAN


# ============================================================
# DEVICE
# ============================================================

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"AI Device: {device}")


# ============================================================
# MODEL LOADING
# ============================================================

print("Loading MiniLM model...")
text_model = SentenceTransformer(
    "sentence-transformers/all-MiniLM-L6-v2",
    device=device
)

print("Loading CLIP model...")
clip_processor = CLIPProcessor.from_pretrained(
    "openai/clip-vit-base-patch32"
)
clip_model = CLIPModel.from_pretrained(
    "openai/clip-vit-base-patch32"
).to(device)
clip_model.eval()

def generate_clip_text_embedding(text_query):
    """Generates a 512-dim embedding from a text query using CLIP to search images."""
    if not text_query:
        return np.zeros(512, dtype=np.float32).tolist()
        
    inputs = clip_processor(text=[text_query], return_tensors="pt", padding=True)
    inputs = {k: v.to(device) for k, v in inputs.items()}
    
    with torch.no_grad():
        output = clip_model.get_text_features(**inputs)
        
    # Safely extract the tensor based on the transformers version
    if isinstance(output, torch.Tensor):
        text_features = output
    elif hasattr(output, "text_embeds"):
        text_features = output.text_embeds
    elif hasattr(output, "pooler_output"):
        text_features = output.pooler_output
    elif hasattr(output, "last_hidden_state"):
        text_features = output.last_hidden_state[:, 0, :]
    else:
        # Fallback for tuple outputs
        text_features = output[0]
        
    # Ensure it's 2D before normalizing
    if text_features.ndim == 1:
        text_features = text_features.unsqueeze(0)
        
    text_features = torch.nn.functional.normalize(text_features, p=2, dim=-1)
    return text_features.cpu().numpy()[0].tolist()
# ============================================================
# FILE TYPES
# ============================================================

IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".bmp",
    ".gif", ".webp", ".tiff", ".tif"
}

TEXT_EXTENSIONS = {
    ".txt", ".pdf", ".docx", ".pptx"
}

def is_image_file(extension):
    return extension.lower() in IMAGE_EXTENSIONS

def is_text_file(extension):
    return extension.lower() in TEXT_EXTENSIONS


# ============================================================
# STOP WORDS
# ============================================================

STOP_WORDS = {
    "the", "and", "for", "with", "from", "this", "that", "file",
    "document", "documents", "image", "images", "copy", "final",
    "new", "old", "pdf", "jpg", "jpeg", "png", "img", "photo",
    "page", "pages", "scan", "download", "downloads", "word",
    "words", "microsoft", "powerpoint", "presentation",
    "presentations", "ppt", "pptx", "doc", "docx", "files",
    "version", "updated", "latest", "week", "weeks", "day", "days"
}


# ============================================================
# TEXT CLEANING
# ============================================================

def clean_text(text):
    if not text:
        return ""

    text = str(text)
    text = re.sub(r"[_\-\.]+", " ", text)
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    text = re.sub(r"[^a-zA-Z0-9\s]", " ", text)
    text = text.lower()

    words = [
        word for word in text.split()
        if word not in STOP_WORDS and len(word) > 2
    ]

    return " ".join(words)


def get_filename_text(metadata):
    return clean_text(metadata.get("file_name", ""))


def get_document_text(metadata):
    return clean_text(metadata.get("text", ""))


# ============================================================
# EMBEDDINGS
# ============================================================

def generate_text_embeddings(text_list):
    if not text_list:
        return np.empty((0, 384), dtype=np.float32)

    cleaned_text = [str(t) if t else "" for t in text_list]

    embeddings = text_model.encode(
        cleaned_text,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=False
    )

    return np.asarray(embeddings, dtype=np.float32)


def generate_image_embeddings(image_path_list):
    embeddings = []
    valid_paths = []

    if not image_path_list:
        return np.empty((0, 512), dtype=np.float32), []

    for image_path in image_path_list:
        try:
            image = Image.open(image_path).convert("RGB")
            inputs = clip_processor(images=image, return_tensors="pt")
            inputs = {k: v.to(device) for k, v in inputs.items()}

            with torch.no_grad():
                output = clip_model.get_image_features(**inputs)

            if isinstance(output, torch.Tensor):
                image_features = output
            elif hasattr(output, "pooler_output"):
                image_features = output.pooler_output
            elif hasattr(output, "last_hidden_state"):
                image_features = output.last_hidden_state[:, 0, :]
            else:
                raise ValueError("Unable to extract CLIP image features.")

            if image_features.ndim == 1:
                image_features = image_features.unsqueeze(0)

            image_features = torch.nn.functional.normalize(image_features, p=2, dim=-1)
            embedding = image_features.detach().cpu().numpy().astype(np.float32)

            embeddings.append(embedding[0])
            valid_paths.append(image_path)

        except Exception as error:
            print(f"Warning: Could not process image '{image_path}': {error}")

    if not embeddings:
        return np.empty((0, 512), dtype=np.float32), []

    return np.vstack(embeddings), valid_paths


# ============================================================
# SIMILARITY UTILS
# ============================================================

def parse_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", ""))
    except Exception:
        return None


def calculate_time_similarity(file_a, file_b):
    date_a = parse_datetime(file_a.get("modified_time") or file_a.get("created_time"))
    date_b = parse_datetime(file_b.get("modified_time") or file_b.get("created_time"))

    if date_a is None or date_b is None:
        return 0.0

    days = abs((date_a - date_b).total_seconds()) / 86400.0

    if days <= 1: return 1.0
    if days <= 3: return 0.75
    if days <= 7: return 0.45
    if days <= 30: return 0.15
    return 0.0


def calculate_keyword_similarity(file_a, file_b):
    words_a = set(get_filename_text(file_a).split())
    words_b = set(get_filename_text(file_b).split())

    if not words_a or not words_b:
        return 0.0

    union = words_a.union(words_b)
    if not union:
        return 0.0

    return len(words_a.intersection(words_b)) / len(union)


def cosine_similarity(vector_a, vector_b):
    if vector_a is None or vector_b is None:
        return 0.0
    
    denominator = np.linalg.norm(vector_a) * np.linalg.norm(vector_b)
    if denominator == 0:
        return 0.0
        
    return float(np.dot(vector_a, vector_b) / denominator)


def clamp(value, minimum=0.0, maximum=1.0):
    return max(minimum, min(maximum, value))


# ============================================================
# MULTI-SIGNAL SIMILARITY
# ============================================================

def calculate_file_similarity(
    file_a, file_b,
    image_embedding_a=None, image_embedding_b=None,
    text_embedding_a=None, text_embedding_b=None
):
    filename_score = calculate_keyword_similarity(file_a, file_b)
    time_score = calculate_time_similarity(file_a, file_b)

    image_a = is_image_file(file_a.get("extension", ""))
    image_b = is_image_file(file_b.get("extension", ""))
    text_a = is_text_file(file_a.get("extension", ""))
    text_b = is_text_file(file_b.get("extension", ""))

    # SAME TYPE: IMAGE + IMAGE
    if image_a and image_b:
        semantic_score = cosine_similarity(image_embedding_a, image_embedding_b)
        semantic_score = clamp((semantic_score + 1) / 2)
        score = 0.65 * semantic_score + 0.20 * filename_score + 0.15 * time_score
        return clamp(score)

    # SAME TYPE: DOCUMENT + DOCUMENT
    if text_a and text_b:
        semantic_score = cosine_similarity(text_embedding_a, text_embedding_b)
        semantic_score = clamp((semantic_score + 1) / 2)
        score = 0.65 * semantic_score + 0.20 * filename_score + 0.15 * time_score
        return clamp(score)

    # CROSS MODAL: IMAGE + DOCUMENT
    if (image_a and text_b) or (text_a and image_b):
        # Compare the MiniLM embedding of the image (derived from its filename) 
        # with the MiniLM embedding of the document.
        semantic_score = cosine_similarity(text_embedding_a, text_embedding_b)
        semantic_score = clamp((semantic_score + 1) / 2)
        
        score = 0.50 * semantic_score + 0.35 * filename_score + 0.15 * time_score
        return clamp(score)

    # FALLBACK
    return clamp(0.60 * filename_score + 0.40 * time_score)


# ============================================================
# SEMANTIC CLUSTER LABEL DEFINITIONS
# ============================================================

SEMANTIC_LABELS = {
    "College Assignments": "Academic college assignments, university assignments, coursework, submitted assignments, subject assignments, individual assignments, group assignments, lab assignments, written academic tasks and semester work.",
    "Project Reports": "Academic or professional project reports, project work, project documentation, project reviews, project phases, implementation reports and technical project documents.",
    "Study Notes": "Study notes, lecture notes, revision material, subject notes, exam preparation notes, class notes and educational reference material used for learning.",
    "Exam Preparation": "Exam preparation material, examination resources, question papers, exam study material, revision resources and preparation documents.",
    "Career Preparation": "Placement preparation, job preparation, interview preparation, coding preparation, technical preparation, career roadmaps, job roadmaps and employment preparation material.",
    "Resumes": "Resumes, CVs, curriculum vitae, biodata, professional profiles, job applications and personal career documents.",
    "Presentations": "Presentation slides, seminar presentations, PowerPoint slides, review presentations, project presentations and slide decks.",
    "Technical Documentation": "Technical documentation, software documentation, programming documentation, system documentation, technical references and engineering documentation.",
    "Research Material": "Research papers, literature surveys, research tables, academic research material, references, literature reviews and research documentation.",
    "Reports": "Formal reports, analysis reports, review reports, summaries, records and structured documentation.",
    "Personal Documents": "Personal documents, personal records, certificates, identity related documents and private administrative files.",
    "Visual Media": "Photographs, screenshots, generated images, visual media, graphics and other image-based content."
}

LABEL_KEYWORDS = {
    "College Assignments": {"assignment": 5, "assignments": 5, "assgn": 4, "coursework": 4, "lab": 3, "academic": 3, "semester": 3, "subject": 3, "submission": 3, "submitted": 3},
    "Project Reports": {"project": 5, "phase": 4, "review": 4, "report": 4, "implementation": 3, "system": 2, "development": 2, "prototype": 3},
    "Study Notes": {"notes": 5, "note": 5, "lecture": 4, "chapter": 3, "unit": 3, "revision": 4, "study": 4},
    "Exam Preparation": {"exam": 5, "examination": 5, "preparation": 5, "revision": 4, "question": 3, "questions": 3, "test": 3},
    "Career Preparation": {"career": 5, "placement": 5, "preparation": 4, "roadmap": 5, "interview": 5, "coding": 3, "sde": 4, "job": 4},
    "Resumes": {"resume": 8, "resumes": 8, "cv": 8, "curriculum": 7, "biodata": 6, "profile": 3},
    "Presentations": {"presentation": 6, "ppt": 6, "slides": 5, "slide": 5, "seminar": 5},
    "Technical Documentation": {"technical": 5, "documentation": 6, "software": 3, "system": 3, "api": 3, "database": 3, "programming": 4, "architecture": 4},
    "Research Material": {"research": 6, "literature": 6, "survey": 5, "paper": 5, "papers": 5, "analysis": 3, "reference": 3},
    "Reports": {"report": 5, "summary": 4, "record": 4, "analysis": 3, "review": 3},
    "Personal Documents": {"personal": 5, "certificate": 5, "certificates": 5, "identity": 5, "record": 2},
    "Visual Media": {"image": 6, "photo": 5, "screenshot": 5, "visual": 4, "picture": 4}
}


def generate_cluster_label(cluster_files):
    if not cluster_files:
        return "Uncategorized Files"

    filename_parts = []
    document_parts = []

    for file_data in cluster_files:
        fname = get_filename_text(file_data)
        dtext = get_document_text(file_data)
        if fname: filename_parts.append(fname)
        if dtext: document_parts.append(dtext[:1000])

    filename_text = " ".join(filename_parts)
    combined_text = (filename_text + " " + " ".join(document_parts)).strip()

    image_count = sum(1 for f in cluster_files if is_image_file(f.get("extension", "")))
    document_count = sum(1 for f in cluster_files if is_text_file(f.get("extension", "")))

    keyword_scores = {}
    normalized_text = combined_text.lower()

    for label, keywords in LABEL_KEYWORDS.items():
        score = 0.0
        for keyword, weight in keywords.items():
            matches = re.findall(rf"\b{re.escape(keyword)}\b", normalized_text)
            if matches:
                score += weight * min(len(matches), 3)
        keyword_scores[label] = score

    # High-confidence filename rules
    filename_lower = filename_text.lower()
    if re.search(r"\bassignment\b|\bassignments\b|\bassgn\b", filename_lower): keyword_scores["College Assignments"] += 15
    if re.search(r"\bresume\b|\bresumes\b|\bcv\b", filename_lower): keyword_scores["Resumes"] += 20
    if re.search(r"\broadmap\b|\bplacement\b|\binterview\b", filename_lower): keyword_scores["Career Preparation"] += 15
    if re.search(r"\bnotes\b|\bnote\b", filename_lower): keyword_scores["Study Notes"] += 15
    if re.search(r"\bppt\b|\bpptx\b|\bpresentation\b|\bslides\b|\bseminar\b", filename_lower): keyword_scores["Presentations"] += 15
    if re.search(r"\bliterature\b|\bsurvey\b|\bresearch\b", filename_lower): keyword_scores["Research Material"] += 15

    semantic_scores = {}
    if combined_text:
        try:
            cluster_embedding = text_model.encode(
                combined_text[:4000], convert_to_numpy=True, normalize_embeddings=True, show_progress_bar=False
            )
            label_names = list(SEMANTIC_LABELS.keys())
            label_embeddings = generate_text_embeddings([SEMANTIC_LABELS[l] for l in label_names])

            for index, label in enumerate(label_names):
                sim = cosine_similarity(cluster_embedding, label_embeddings[index])
                semantic_scores[label] = clamp((sim + 1) / 2)
        except Exception:
            pass

    final_scores = {}
    for label in SEMANTIC_LABELS:
        kw_score = clamp(keyword_scores.get(label, 0.0) / 25.0)
        sem_score = semantic_scores.get(label, 0.0)
        final_scores[label] = 0.65 * kw_score + 0.35 * sem_score

    if image_count == len(cluster_files) and image_count > 0:
        return "Visual Media"

    if final_scores:
        ranked = sorted(final_scores, key=final_scores.get, reverse=True)
        best_label = ranked[0]
        best_score = final_scores[best_label]

        if best_score >= 0.38:
            if final_scores.get("College Assignments", 0.0) >= 0.45 and re.search(r"\bassignment\b|\bassignments\b|\bassgn\b", normalized_text):
                return "College Assignments"
            if final_scores.get("Resumes", 0.0) >= 0.50 and re.search(r"\bresume\b|\bresumes\b|\bcv\b", normalized_text):
                return "Resumes"
            return best_label

    extensions = [f.get("extension", "").lower() for f in cluster_files]
    if extensions:
        if all(e in {".ppt", ".pptx"} for e in extensions): return "Presentations"
        if all(e in {".doc", ".docx"} for e in extensions): return "Word Documents"
        if all(e == ".pdf" for e in extensions): return "PDF Documents"

    if image_count > 0 and document_count > 0: return "Mixed Visual & Documents"
    if document_count > 0: return "Documents"
    return "Files"


# ============================================================
# GENERATE CLUSTER REASONS
# ============================================================

def generate_cluster_reasons(cluster_files):
    reasons = []
    if len(cluster_files) < 2:
        return ["Only one file in this group."]

    # 1. Filename keyword overlap
    kw_scores = [
        calculate_keyword_similarity(cluster_files[i], cluster_files[j])
        for i in range(len(cluster_files)) for j in range(i + 1, len(cluster_files))
    ]
    if kw_scores and np.mean(kw_scores) >= 0.20:
        reasons.append("Similar filename keywords")

    # 2. Time relationship
    time_scores = [
        calculate_time_similarity(cluster_files[i], cluster_files[j])
        for i in range(len(cluster_files)) for j in range(i + 1, len(cluster_files))
    ]
    if time_scores and np.mean(time_scores) >= 0.70:
        reasons.append("Files were created or modified around the same time")

    # 3. Document content
    documents = [get_document_text(f) for f in cluster_files if get_document_text(f)]
    if len(documents) >= 2:
        try:
            embeddings = generate_text_embeddings(documents)
            sims = [
                cosine_similarity(embeddings[i], embeddings[j])
                for i in range(len(embeddings)) for j in range(i + 1, len(embeddings))
            ]
            if sims and max(sims) >= 0.65:
                reasons.append("Related document content")
        except Exception:
            pass

    # 4. File type diversity
    categories = set(f.get("category", "other") for f in cluster_files)
    if "image" in categories and "document" in categories:
        reasons.append("Contains related images and documents")

    # 5. Specific extensions
    extensions = {f.get("extension", "").lower() for f in cluster_files}
    if bool(extensions.intersection({".doc", ".docx"})) and bool(extensions.intersection({".ppt", ".pptx"})):
        reasons.append("Contains related Word and PowerPoint files")
    elif len(extensions) == 1:
        ext = next(iter(extensions))
        if ext == ".pdf": reasons.append("Contains PDF documents")
        elif ext in {".doc", ".docx"}: reasons.append("Contains Word documents")
        elif ext in {".ppt", ".pptx"}: reasons.append("Contains PowerPoint presentations")

    if not reasons:
        reasons.append("Files share semantic, temporal, or textual similarities.")

    return reasons


def calculate_cluster_confidence(cluster_files, similarity_matrix, indices):
    if len(indices) <= 1: return 50
    scores = [
        similarity_matrix[indices[i], indices[j]]
        for i in range(len(indices)) for j in range(i + 1, len(indices))
    ]
    if not scores: return 50
    return int(round(clamp(50 + np.mean(scores) * 50, 0, 100)))


# ============================================================
# MAIN CLUSTERING FUNCTION
# ============================================================

def cluster_files(metadata_list):
    print(f"\nStarting AI analysis of {len(metadata_list)} files...")

    if not metadata_list:
        return {"device": device, "total_files": 0, "analyzed_files": 0, "total_clusters": 0, "clusters": {}, "files": []}

    analyzable_metadata = [
        m for m in metadata_list
        if is_image_file(m.get("extension", "")) or (is_text_file(m.get("extension", "")) and m.get("text"))
    ]
    print(f"Analyzable files: {len(analyzable_metadata)}")

    # 1. IMAGE EMBEDDINGS (CLIP)
    image_metadata = [m for m in analyzable_metadata if is_image_file(m.get("extension", ""))]
    image_embeddings = {}
    if image_metadata:
        print("Generating CLIP image embeddings...")
        paths = [m["file_path"] for m in image_metadata]
        embs, valid = generate_image_embeddings(paths)
        for i, p in enumerate(valid):
            image_embeddings[p] = embs[i]

    # 2. UNIVERSAL TEXT EMBEDDINGS (MiniLM)
    # We generate a text embedding for ALL files to support cross-modal similarity.
    print("Generating MiniLM text embeddings for all files...")
    text_embeddings = {}
    if analyzable_metadata:
        texts_to_embed = []
        for item in analyzable_metadata:
            fname = get_filename_text(item)
            dtext = get_document_text(item)
            texts_to_embed.append(f"{fname} {dtext}".strip())
            
        embs = generate_text_embeddings(texts_to_embed)
        for i, item in enumerate(analyzable_metadata):
            text_embeddings[item["file_path"]] = embs[i]

    # 3. FILTER ANALYZED FILES
    analyzed_metadata = [
        m for m in analyzable_metadata
        if m["file_path"] in text_embeddings and (not is_image_file(m.get("extension", "")) or m["file_path"] in image_embeddings)
    ]

    n_files = len(analyzed_metadata)
    if n_files == 0:
        return {"device": device, "total_files": len(metadata_list), "analyzed_files": 0, "total_clusters": 0, "clusters": {}, "files": []}

    print(f"Successfully analyzed {n_files} files.")

    # 4. BUILD SIMILARITY MATRIX
    print("Calculating multi-signal file similarity...")
    similarity_matrix = np.eye(n_files, dtype=np.float32)

    for i in range(n_files):
        for j in range(i + 1, n_files):
            file_a, file_b = analyzed_metadata[i], analyzed_metadata[j]
            path_a, path_b = file_a["file_path"], file_b["file_path"]

            score = calculate_file_similarity(
                file_a, file_b,
                image_embeddings.get(path_a), image_embeddings.get(path_b),
                text_embeddings.get(path_a), text_embeddings.get(path_b)
            )
            similarity_matrix[i, j] = similarity_matrix[j, i] = score

    # 5. DBSCAN CLUSTERING
    distance_matrix = np.clip(1.0 - similarity_matrix, 0.0, 1.0)
    print("Running DBSCAN clustering...")
    
    if n_files >= 2:
        clustering = DBSCAN(eps=0.38, min_samples=2, metric="precomputed")
        cluster_labels = clustering.fit_predict(distance_matrix)
    else:
        cluster_labels = np.array([0])

# 6. BUILD RESULT
    clusters = {}
    result_files = []

    for index, metadata in enumerate(analyzed_metadata):
        cluster_id = int(cluster_labels[index])
        file_result = {
            "file_name": metadata.get("file_name"),
            "file_path": metadata.get("file_path"),
            "extension": metadata.get("extension"),
            "category": metadata.get("category"),
            "file_size_mb": metadata.get("file_size_mb", 0),
            "modified_time": metadata.get("modified_time"), 
            "created_time": metadata.get("created_time"),   
            "cluster_id": cluster_id
        }
        result_files.append(file_result)

        if cluster_id == -1: continue

        if cluster_id not in clusters:
            clusters[cluster_id] = {"label": "", "confidence": 0, "reasons": [], "files": [], "_indices": []}
        
        clusters[cluster_id]["files"].append(file_result)
        clusters[cluster_id]["_indices"].append(index)

    for cluster_id, cluster_data in clusters.items():
        c_files = cluster_data["files"]
        indices = cluster_data["_indices"]
        cluster_data["label"] = generate_cluster_label(c_files)
        cluster_data["confidence"] = calculate_cluster_confidence(c_files, similarity_matrix, indices)
        cluster_data["reasons"] = generate_cluster_reasons(c_files)
        del cluster_data["_indices"]

    # 7. ADD UNANALYZED FILES
    analyzed_paths = {m["file_path"] for m in analyzed_metadata}
    for metadata in metadata_list:
        path = metadata["file_path"]
        if path not in analyzed_paths:
            result_files.append({
                "file_name": metadata.get("file_name"),
                "file_path": path,
                "extension": metadata.get("extension"),
                "category": metadata.get("category"),
                "file_size_mb": metadata.get("file_size_mb", 0),
                "modified_time": metadata.get("modified_time"), 
                "created_time": metadata.get("created_time"),
                "cluster_id": -1,
                "status": "not_analyzed"
            })

    print("\nAI analysis completed successfully.")
    return {
        "device": device,
        "total_files": len(metadata_list),
        "analyzed_files": len(analyzed_metadata),
        "total_clusters": len(clusters),
        "clusters": clusters,
        "files": result_files
    }