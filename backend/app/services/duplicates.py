import os
import hashlib
from collections import defaultdict
from pathlib import Path

def get_file_hash(filepath, chunk_size=65536):
    """Generates a SHA-256 hash reading the file in chunks for memory efficiency."""
    hasher = hashlib.sha256()
    try:
        with open(filepath, 'rb') as f:
            while chunk := f.read(chunk_size):
                hasher.update(chunk)
        return hasher.hexdigest()
    except Exception:
        return None

def find_duplicates(folder_path):
    """
    Stage 1: Group by exact byte size.
    Stage 2: Hash files that share the exact same size.
    """
    folder = Path(folder_path)
    if not folder.exists() or not folder.is_dir():
        raise ValueError("Invalid folder path.")

    # Stage 1: Fast Filter by exact byte size
    size_groups = defaultdict(list)
    for root, _, files in os.walk(folder):
        for file in files:
            filepath = Path(root) / file
            try:
                size = filepath.stat().st_size
                if size > 0:  # Ignore 0-byte files
                    size_groups[size].append(filepath)
            except Exception:
                pass

    # Stage 2: Deep Hash Check
    duplicates = []
    for size, paths in size_groups.items():
        if len(paths) > 1:
            hash_groups = defaultdict(list)
            for path in paths:
                file_hash = get_file_hash(path)
                if file_hash:
                    stat = path.stat()
                    hash_groups[file_hash].append({
                        "file_name": path.name,
                        "file_path": str(path),
                        "size_bytes": size,
                        "modified_time": stat.st_mtime,
                        "created_time": stat.st_ctime
                    })
            
            for file_hash, group in hash_groups.items():
                if len(group) > 1:
                    # Sort by creation time (Oldest first)
                    group.sort(key=lambda x: x["created_time"])
                    duplicates.append({
                        "hash": file_hash,
                        "size_bytes": size,
                        "files": group
                    })
                    
    return duplicates

def resolve_duplicates(file_paths):
    """Permanently deletes the selected duplicate files."""
    deleted = []
    errors = []
    for path in file_paths:
        try:
            os.remove(path)
            deleted.append(path)
        except Exception as e:
            errors.append({"path": path, "error": str(e)})
            
    return {"deleted": deleted, "errors": errors}