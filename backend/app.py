import os
from pathlib import Path
from flask import Flask, jsonify, request
from flask_cors import CORS

from app.services.scanner import scan_directory
from app.services.ai_engine import cluster_files
from app.services.organization import consolidate_clusters, organize_files
from app.services.duplicates import find_duplicates, resolve_duplicates

from app.services.vector_db_service import semantic_search
from app.services.ai_engine import generate_text_embeddings, generate_clip_text_embedding

from flask import send_file

app = Flask(__name__)
CORS(app)

@app.get("/")
def home():
    return jsonify({
        "status": "running",
        "message": "Smart File Intelligence Engine API"
    }), 200


@app.post("/api/scan")
def scan():
    try:
        data = request.get_json(silent=True)

        if not isinstance(data, dict):
            return jsonify({"error": "Request body must be a JSON object."}), 400

        folder_path = data.get("folder_path")

        if not folder_path or not str(folder_path).strip():
            return jsonify({"error": "folder_path is required and cannot be empty."}), 400

        folder = Path(str(folder_path).strip())

        if not folder.exists():
            return jsonify({"error": f"Folder does not exist: {folder_path}"}), 400

        if not folder.is_dir():
            return jsonify({"error": f"Path is not a directory: {folder_path}"}), 400

        # 1. Scan and Cluster
        metadata = scan_directory(folder_path)
        result = cluster_files(metadata)

        # 2. Consolidate micro-clusters and ungrouped files
        consolidated_clusters = consolidate_clusters(
            result.get("clusters", {}), 
            result.get("files", [])
        )

        return jsonify({
            "success": True,
            "folder_path": str(folder.resolve()),
            "total_files": result.get("total_files", len(metadata)),
            "analyzed_files": result.get("analyzed_files", 0),
            "total_clusters": len(consolidated_clusters),  # Updated count
            "clusters": consolidated_clusters,             # Updated clusters
            "files": result.get("files", []),
            "device": result.get("device")
        }), 200

    except Exception as error:
        print(f"Unexpected error in /api/scan: {error}")
        return jsonify({
            "error": "An internal server error occurred.",
            "details": str(error)
        }), 500


@app.post("/api/organize")
def organize():
    try:
        data = request.get_json(silent=True)

        if not isinstance(data, dict):
            return jsonify({"error": "Request body must be a JSON object."}), 400

        target_path = data.get("target_path")

        if not target_path or not str(target_path).strip():
            return jsonify({"error": "target_path is required and cannot be empty."}), 400

        recommended_structure = (
            data.get("recommended_structure")
            or data.get("folders")
            or data.get("recommendations")
        )

        if recommended_structure is None:
            return jsonify({"error": "recommended_structure is required."}), 400

        # Default to True for safety (Dry Run)
        dry_run = data.get("dry_run", True)

        if not isinstance(dry_run, bool):
            return jsonify({"error": "dry_run must be true or false."}), 400

        # Delegate to the organization module
        result = organize_files(
            target_path=target_path,
            recommended_structure=recommended_structure,
            dry_run=dry_run
        )

        return jsonify(result), 200

    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    except Exception as error:
        print(f"Unexpected error in /api/organize: {error}")
        return jsonify({
            "error": "An internal server error occurred.",
            "details": str(error)
        }), 500

@app.post("/api/duplicates/scan")
def scan_duplicates():
    try:
        data = request.get_json(silent=True)
        folder_path = data.get("folder_path")
        
        if not folder_path:
            return jsonify({"error": "folder_path is required."}), 400
            
        duplicates = find_duplicates(folder_path)
        return jsonify({"success": True, "duplicates": duplicates}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.post("/api/duplicates/resolve")
def resolve_duplicates_route():
    try:
        data = request.get_json(silent=True)
        file_paths = data.get("file_paths", [])
        
        if not file_paths:
            return jsonify({"error": "No files provided for deletion."}), 400
            
        result = resolve_duplicates(file_paths)
        return jsonify({"success": True, **result}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.post("/api/search/semantic")
def search_semantic():
    try:
        data = request.get_json(silent=True)
        query = data.get("query", "").strip()
        top_k = data.get("top_k", 10)
        file_type = data.get("file_type", "all") # 'all', 'image', or 'document'
        
        if not query:
            return jsonify({"error": "Search query cannot be empty."}), 400

        # 1. Embed query for Documents (MiniLM - 384 dim)
        doc_emb = generate_text_embeddings([query])[0].tolist()
        
        # 2. Embed query for Images (CLIP - 512 dim)
        img_emb = generate_clip_text_embedding(query)
        
        # 3. Query ChromaDB
        results = semantic_search(
            query_doc_emb=doc_emb,
            query_img_emb=img_emb,
            top_k=top_k,
            threshold=0.25, # Slightly lower threshold for natural language fuzziness
            file_type_filter=file_type
        )
        
        return jsonify({
            "success": True,
            "query": query,
            "results": results
        }), 200

    except Exception as e:
        print(f"Semantic Search Error: {e}")
        return jsonify({"error": "An internal error occurred during search."}), 500

@app.get("/api/preview")
def preview_file():
    path = request.args.get("path")
    if os.path.exists(path):
        return send_file(path)
    return "Not found", 404

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)