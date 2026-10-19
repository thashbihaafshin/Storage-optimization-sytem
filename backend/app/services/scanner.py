import os
from pathlib import Path
from datetime import datetime

from pypdf import PdfReader
from docx import Document
from pptx import Presentation


# Maximum amount of text stored from a document.
MAX_TEXT_LENGTH = 5000


def get_file_category(extension):
    """
    Determine the general category of a file based on its extension.
    """
    extension = extension.lower()

    image_extensions = {
        ".jpg", ".jpeg", ".png", ".gif", ".bmp",
        ".webp", ".tiff", ".tif", ".svg"
    }

    document_extensions = {
        ".pdf", ".txt", ".doc", ".docx",
        ".xls", ".xlsx", ".ppt", ".pptx",
        ".csv", ".rtf"
    }

    code_extensions = {
        ".py", ".js", ".jsx", ".ts", ".tsx",
        ".java", ".c", ".cpp", ".h", ".hpp",
        ".cs", ".php", ".html", ".css",
        ".sql", ".sh", ".bat"
    }

    if extension in image_extensions:
        return "image"

    if extension in document_extensions:
        return "document"

    if extension in code_extensions:
        return "code"

    return "other"


def extract_txt_text(file_path):
    """
    Extract text from a TXT file.
    """
    try:
        with open(
            file_path,
            "r",
            encoding="utf-8",
            errors="replace"
        ) as file:

            return file.read(MAX_TEXT_LENGTH)

    except Exception as error:
        print(
            f"Warning: Could not extract text from TXT "
            f"'{file_path}': {error}"
        )

    return ""


def extract_pdf_text(file_path):
    """
    Extract text from a PDF file.
    """
    try:
        reader = PdfReader(file_path)

        extracted_text = []

        for page in reader.pages:
            page_text = page.extract_text() or ""

            if page_text:
                extracted_text.append(page_text)

            current_length = sum(
                len(text) for text in extracted_text
            )

            if current_length >= MAX_TEXT_LENGTH:
                break

        return "\n".join(extracted_text)[:MAX_TEXT_LENGTH]

    except Exception as error:
        print(
            f"Warning: Could not extract text from PDF "
            f"'{file_path}': {error}"
        )

    return ""


def extract_docx_text(file_path):
    """
    Extract text from a DOCX file.

    Extracts:
    - Paragraph text
    - Table contents
    """
    try:
        document = Document(file_path)

        text_parts = []

        # Extract paragraphs
        for paragraph in document.paragraphs:
            text = paragraph.text.strip()

            if text:
                text_parts.append(text)

        # Extract tables
        for table in document.tables:

            for row in table.rows:

                row_text = []

                for cell in row.cells:
                    cell_text = cell.text.strip()

                    if cell_text:
                        row_text.append(cell_text)

                if row_text:
                    text_parts.append(
                        " | ".join(row_text)
                    )

        extracted_text = "\n".join(text_parts)

        return extracted_text[:MAX_TEXT_LENGTH]

    except Exception as error:
        print(
            f"Warning: Could not extract text from DOCX "
            f"'{file_path}': {error}"
        )

    return ""


def extract_pptx_text(file_path):
    """
    Extract text from a PPTX presentation.

    Extracts:
    - Slide number
    - Slide titles
    - Text from text-containing shapes
    """
    try:
        presentation = Presentation(file_path)

        text_parts = []

        for slide_number, slide in enumerate(
            presentation.slides,
            start=1
        ):

            slide_text = []

            for shape in slide.shapes:

                if not hasattr(shape, "text"):
                    continue

                text = shape.text.strip()

                if text:
                    slide_text.append(text)

            if slide_text:

                slide_content = (
                    f"Slide {slide_number}: "
                    + " ".join(slide_text)
                )

                text_parts.append(slide_content)

        extracted_text = "\n".join(text_parts)

        return extracted_text[:MAX_TEXT_LENGTH]

    except Exception as error:
        print(
            f"Warning: Could not extract text from PPTX "
            f"'{file_path}': {error}"
        )

    return ""


def extract_text(file_path, extension):
    """
    Extract text from supported document formats.

    Supported:
    - TXT
    - PDF
    - DOCX
    - PPTX

    Returns an empty string when text cannot be extracted.
    """

    extension = extension.lower()

    if extension == ".txt":
        return extract_txt_text(file_path)

    if extension == ".pdf":
        return extract_pdf_text(file_path)

    if extension == ".docx":
        return extract_docx_text(file_path)

    if extension == ".pptx":
        return extract_pptx_text(file_path)

    return ""


def scan_directory(folder_path):
    """
    Recursively scan a directory and return metadata
    for every accessible file.

    Returns:
        list[dict]: Metadata for each accessible file.
    """

    folder = Path(folder_path)

    if not folder.exists():
        raise FileNotFoundError(
            f"The folder does not exist: {folder_path}"
        )

    if not folder.is_dir():
        raise NotADirectoryError(
            f"The provided path is not a directory: {folder_path}"
        )

    results = []

    # Recursively traverse the directory.
    for root, directories, files in os.walk(
        folder,
        onerror=None
    ):

        # Keep only accessible directories.
        accessible_directories = []

        for directory in directories:

            directory_path = Path(root) / directory

            try:

                if os.access(
                    directory_path,
                    os.R_OK
                ):
                    accessible_directories.append(
                        directory
                    )

                else:
                    print(
                        f"Warning: Permission denied for "
                        f"directory: {directory_path}"
                    )

            except OSError as error:

                print(
                    f"Warning: Could not access directory "
                    f"'{directory_path}': {error}"
                )

        directories[:] = accessible_directories

        # Process files.
        for file_name in files:

            file_path = Path(root) / file_name

            try:

                # Retrieve file information.
                file_stats = file_path.stat()

                extension = file_path.suffix.lower()

                file_size_mb = (
                    file_stats.st_size
                    / (1024 * 1024)
                )

                created_time = datetime.fromtimestamp(
                    file_stats.st_ctime
                ).isoformat()

                modified_time = datetime.fromtimestamp(
                    file_stats.st_mtime
                ).isoformat()

                category = get_file_category(
                    extension
                )

                # Extract text from supported formats.
                text = extract_text(
                    file_path,
                    extension
                )

                file_info = {
                    "file_name": file_name,
                    "file_path": str(
                        file_path.resolve()
                    ),
                    "extension": extension,
                    "file_size_mb": round(
                        file_size_mb,
                        4
                    ),
                    "created_time": created_time,
                    "modified_time": modified_time,
                    "category": category,
                    "text": text
                }

                results.append(file_info)

            except PermissionError:

                print(
                    f"Warning: Permission denied: "
                    f"{file_path}"
                )

            except OSError as error:

                print(
                    f"Warning: Could not read file "
                    f"'{file_path}': {error}"
                )

            except Exception as error:

                print(
                    f"Warning: Unexpected error while "
                    f"processing '{file_path}': {error}"
                )

    return results


if __name__ == "__main__":

    # Change this path to the folder you want to scan.
    folder_to_scan = input(
        "Enter the folder path to scan: "
    ).strip()

    try:

        scanned_files = scan_directory(
            folder_to_scan
        )

        print("\n" + "=" * 60)
        print("SCAN COMPLETE")
        print("=" * 60)

        print(
            f"Total accessible files: "
            f"{len(scanned_files)}"
        )

        for index, file_info in enumerate(
            scanned_files,
            start=1
        ):

            print(f"\nFile {index}")

            print(
                f"  Name      : "
                f"{file_info['file_name']}"
            )

            print(
                f"  Path      : "
                f"{file_info['file_path']}"
            )

            print(
                f"  Extension : "
                f"{file_info['extension']}"
            )

            print(
                f"  Size (MB) : "
                f"{file_info['file_size_mb']}"
            )

            print(
                f"  Created   : "
                f"{file_info['created_time']}"
            )

            print(
                f"  Modified  : "
                f"{file_info['modified_time']}"
            )

            print(
                f"  Category  : "
                f"{file_info['category']}"
            )

            if file_info["text"]:

                preview = (
                    file_info["text"]
                    .replace("\n", " ")
                )

                print(
                    f"  Text      : "
                    f"{preview[:300]}..."
                )

    except FileNotFoundError as error:

        print(f"\nError: {error}")

    except NotADirectoryError as error:

        print(f"\nError: {error}")

    except PermissionError as error:

        print(
            f"\nError: Permission denied: {error}"
        )

    except OSError as error:

        print(
            f"\nError accessing the folder: {error}"
        )

    except KeyboardInterrupt:

        print(
            "\n\nScan cancelled by user."
        )

    except Exception as error:

        print(
            f"\nUnexpected error: {error}"
        )
