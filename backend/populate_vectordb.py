import os
from pathlib import Path
from app.services.scanner import scan_directory
from app.services.ai_engine import (
    is_image_file, 
    is_text_file, 
    generate_image_embeddings, 
    generate_text_embeddings,
    get_document_text,
    get_filename_text
)
from app.services.vector_db_service import upsert_vector

def populate_database(folder_path):
    print(f"Scanning directory: {folder_path}")
    metadata_list = scan_directory(folder_path)
    
    print(f"Found {len(metadata_list)} files. Processing embeddings...")
    
    for item in metadata_list:
        file_path = item["file_path"]
        ext = item.get("extension", "").lower()
        
        # Base metadata payload
        meta = {
            "file_name": item.get("file_name", ""),
            "file_path": file_path,
            "extension": ext,
            "category": item.get("category", "other"),
            "file_size_mb": item.get("file_size_mb", 0)
        }
        
        try:
            if is_image_file(ext):
                print(f"Embedding Image: {item['file_name']}")
                emb, valid = generate_image_embeddings([file_path])
                if len(emb) > 0:
                    upsert_vector(file_id=file_path, embedding=emb[0].tolist(), metadata=meta, is_image=True)
                    
            elif is_text_file(ext) and item.get("text"):
                print(f"Embedding Document: {item['file_name']}")
                # Combine filename and document text for richer semantic context
                combined_text = f"{get_filename_text(item)} {get_document_text(item)}".strip()
                emb = generate_text_embeddings([combined_text])
                if len(emb) > 0:
                    upsert_vector(file_id=file_path, embedding=emb[0].tolist(), metadata=meta, is_image=False)
                    
        except Exception as e:
            print(f"Failed to process {file_path}: {e}")

    print("Database population complete!")

if __name__ == "__main__":
    target_folder = input("Enter folder path to index into Vector DB: ").strip()
    if os.path.exists(target_folder):
        populate_database(target_folder)
    else:
        print("Invalid folder path.")