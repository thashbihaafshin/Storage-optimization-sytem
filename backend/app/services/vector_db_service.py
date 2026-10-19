import os
import chromadb
from chromadb.config import Settings

# Initialize persistent ChromaDB client
DB_PATH = os.path.join(os.getcwd(), "chroma_db")
chroma_client = chromadb.PersistentClient(path=DB_PATH)

# We use cosine similarity (Chroma returns distance: 1 - cosine_similarity)
# Documents: 384-dim (MiniLM) | Images: 512-dim (CLIP)
doc_collection = chroma_client.get_or_create_collection(
    name="documents", metadata={"hnsw:space": "cosine"}
)
img_collection = chroma_client.get_or_create_collection(
    name="images", metadata={"hnsw:space": "cosine"}
)

def upsert_vector(file_id, embedding, metadata, is_image=False):
    """Upserts a file's vector and metadata into the appropriate collection."""
    collection = img_collection if is_image else doc_collection
    
    # ChromaDB requires metadata values to be str, int, float, or bool
    safe_metadata = {k: str(v) if not isinstance(v, (int, float, bool, str)) else v for k, v in metadata.items()}
    
    collection.upsert(
        ids=[str(file_id)],
        embeddings=[embedding],
        metadatas=[safe_metadata]
    )

def delete_vector(file_id, is_image=False):
    """Removes a file from the vector database."""
    collection = img_collection if is_image else doc_collection
    try:
        collection.delete(ids=[str(file_id)])
    except Exception:
        pass

def semantic_search(query_doc_emb, query_img_emb, top_k=10, threshold=0.35, file_type_filter=None):
    """
    Queries both collections, normalizes distances to similarity scores, 
    and merges the results ranked by relevance.
    """
    results = []

    # 1. Search Documents (MiniLM)
    if file_type_filter in [None, "all", "document"]:
        doc_res = doc_collection.query(
            query_embeddings=[query_doc_emb],
            n_results=top_k
        )
        if doc_res["ids"] and doc_res["ids"][0]:
            for i in range(len(doc_res["ids"][0])):
                # Chroma Cosine Distance = 1 - Cosine Similarity
                similarity = 1.0 - doc_res["distances"][0][i]
                if similarity >= threshold:
                    results.append({
                        "file_id": doc_res["ids"][0][i],
                        "similarity": similarity,
                        "metadata": doc_res["metadatas"][0][i],
                        "type": "document"
                    })

    # 2. Search Images (CLIP)
    if file_type_filter in [None, "all", "image"]:
        img_res = img_collection.query(
            query_embeddings=[query_img_emb],
            n_results=top_k
        )
        if img_res["ids"] and img_res["ids"][0]:
            for i in range(len(img_res["ids"][0])):
                similarity = 1.0 - img_res["distances"][0][i]
                if similarity >= threshold:
                    results.append({
                        "file_id": img_res["ids"][0][i],
                        "similarity": similarity,
                        "metadata": img_res["metadatas"][0][i],
                        "type": "image"
                    })

    # 3. Merge, Sort by Similarity (Descending), and slice Top K
    results.sort(key=lambda x: x["similarity"], reverse=True)
    return results[:top_k]
    