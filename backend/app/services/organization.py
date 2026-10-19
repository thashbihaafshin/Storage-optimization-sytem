import os
import shutil
from pathlib import Path

def normalize_folder_name(name):
    """Sanitizes folder names to ensure they are valid across OS platforms."""
    name = str(name).strip()

    if not name:
        return "Uncategorized"

    for character in '<>:"/\\|?*':
        name = name.replace(character, "_")

    name = name.rstrip(". ")

    return name or "Uncategorized"


def resolve_source_path(file_item):
    """Safely extracts the source file path from various dictionary formats."""
    return (
        file_item.get("file_path")
        or file_item.get("path")
        or file_item.get("source_path")
    )


def extract_organization_items(recommended_structure):
    """
    Converts supported recommendation formats into a standard list of tuples:
        [(source_path, target_folder), ...]
    """
    items = []

    if isinstance(recommended_structure, dict):
        for target_folder, files in recommended_structure.items():
            if not isinstance(files, list):
                continue

            safe_folder = normalize_folder_name(target_folder)

            for file_item in files:
                if isinstance(file_item, str):
                    source_path = file_item
                elif isinstance(file_item, dict):
                    source_path = resolve_source_path(file_item)
                else:
                    continue

                if source_path:
                    items.append((source_path, safe_folder))

    elif isinstance(recommended_structure, list):
        for item in recommended_structure:
            if not isinstance(item, dict):
                continue

            source_path = resolve_source_path(item)
            target_folder = (
                item.get("target_folder")
                or item.get("folder")
                or item.get("category")
            )

            if source_path and target_folder:
                items.append((source_path, normalize_folder_name(target_folder)))
                continue

            folder = (
                item.get("folder")
                or item.get("target_folder")
                or item.get("category")
            )
            files = item.get("files")

            if folder and isinstance(files, list):
                safe_folder = normalize_folder_name(folder)
                for file_item in files:
                    if isinstance(file_item, str):
                        source_path = file_item
                    elif isinstance(file_item, dict):
                        source_path = resolve_source_path(file_item)
                    else:
                        continue

                    if source_path:
                        items.append((source_path, safe_folder))

    return items


def consolidate_clusters(clusters, all_files):
    """
    Merges micro-clusters that share the exact same label.
    Also gathers all ungrouped files (cluster_id == -1) into an 'Uncategorized' folder.
    """
    consolidated = {}

    # 1. Merge AI-generated clusters by label
    for cluster_id, cluster_data in clusters.items():
        label = cluster_data.get("label", "Uncategorized")
        safe_label = normalize_folder_name(label)

        if safe_label not in consolidated:
            consolidated[safe_label] = {
                "label": safe_label,
                "confidence": cluster_data.get("confidence", 0),
                "reasons": set(cluster_data.get("reasons", [])),
                "files": []
            }
        else:
            # Average the confidence scores of merged micro-clusters
            existing_conf = consolidated[safe_label]["confidence"]
            new_conf = cluster_data.get("confidence", 0)
            consolidated[safe_label]["confidence"] = (existing_conf + new_conf) // 2
            
            # Merge reasons
            consolidated[safe_label]["reasons"].update(cluster_data.get("reasons", []))

        # Append files
        consolidated[safe_label]["files"].extend(cluster_data.get("files", []))

    # 2. Handle ungrouped/noise files
    ungrouped_files = [f for f in all_files if f.get("cluster_id") == -1]
    
    if ungrouped_files:
        if "Uncategorized" not in consolidated:
            consolidated["Uncategorized"] = {
                "label": "Uncategorized",
                "confidence": 0,
                "reasons": set(["Files did not strongly match any specific AI category."]),
                "files": []
            }
        consolidated["Uncategorized"]["files"].extend(ungrouped_files)

    # 3. Convert sets back to lists for JSON serialization
    for label, data in consolidated.items():
        data["reasons"] = list(data["reasons"])

    return consolidated


def generate_recommendations(clusters, all_files=None):
    """
    Converts AI clusters into a recommended folder structure.
    """
    if all_files is None:
        all_files = []
        
    consolidated = consolidate_clusters(clusters, all_files)
    
    recommendations = {}
    for label, data in consolidated.items():
        recommendations[label] = [
            {
                "file_path": f.get("file_path"),
                "file_name": f.get("file_name")
            }
            for f in data.get("files", [])
        ]
        
    return recommendations


def preview_organization(target_path, recommendations):
    """Wrapper function to explicitly run a dry-run preview."""
    return organize_files(target_path, recommendations, dry_run=True)


def organize_files(target_path, recommended_structure, dry_run=True):
    """
    Core engine for moving files based on AI recommendations.
    Defaults to dry_run=True to prevent accidental file moves.
    """
    organization_items = extract_organization_items(recommended_structure)

    if not organization_items:
        raise ValueError("No valid file organization recommendations were found.")

    target_root = Path(target_path).resolve()

    if not dry_run:
        target_root.mkdir(parents=True, exist_ok=True)

    moved_files = []
    skipped_files = []
    errors = []

    for source_path, target_folder in organization_items:
        try:
            source = Path(source_path)

            if not source.exists():
                skipped_files.append({
                    "file_path": str(source),
                    "reason": "Source file does not exist."
                })
                continue

            if not source.is_file():
                skipped_files.append({
                    "file_path": str(source),
                    "reason": "Source path is not a file."
                })
                continue

            destination_folder = target_root / target_folder
            destination = destination_folder / source.name

            try:
                if source.resolve() == destination.resolve():
                    skipped_files.append({
                        "file_path": str(source),
                        "reason": "Source and destination are identical."
                    })
                    continue
            except OSError:
                pass

            if dry_run:
                moved_files.append({
                    "file_name": source.name,
                    "source_path": str(source),
                    "destination_path": str(destination),
                    "target_folder": target_folder,
                    "action": "would_move"
                })
                continue

            destination_folder.mkdir(parents=True, exist_ok=True)
            final_destination = destination

            # Handle filename collisions
            if final_destination.exists():
                stem = source.stem
                suffix = source.suffix
                counter = 1

                while final_destination.exists():
                    final_destination = destination_folder / f"{stem} ({counter}){suffix}"
                    counter += 1

            shutil.move(str(source), str(final_destination))

            moved_files.append({
                "file_name": source.name,
                "source_path": str(source),
                "destination_path": str(final_destination),
                "target_folder": target_folder,
                "action": "moved"
            })

        except PermissionError as error:
            errors.append({
                "file_path": source_path,
                "reason": f"Permission denied: {error}"
            })
        except OSError as error:
            errors.append({
                "file_path": source_path,
                "reason": str(error)
            })
        except Exception as error:
            errors.append({
                "file_path": source_path,
                "reason": str(error)
            })

    return {
        "success": len(errors) == 0,
        "dry_run": dry_run,
        "target_path": str(target_root),
        "total_requested": len(organization_items),
        "moved_count": len(moved_files),
        "skipped_count": len(skipped_files),
        "error_count": len(errors),
        "moved_files": moved_files,
        "skipped_files": skipped_files,
        "errors": errors
    }