from pathlib import Path

path = Path(".github/scripts/pr3247_propagate_chunk_principals.py")
text = path.read_text(encoding="utf-8")
old = '''    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one exact match, found {count}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")'''
new = '''    count = text.count(old)
    if label == "system tools call principal" and count == 2:
        file_path.write_text(text.replace(old, new, 1), encoding="utf-8")
        return
    if count != 1:
        raise SystemExit(f"{label}: expected one exact match, found {count}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")'''
if new in text:
    raise SystemExit("principal patcher preparation was already applied")
if text.count(old) != 1:
    raise SystemExit(f"principal patcher preparation boundary mismatch: {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("PR3247 principal patcher prepared")
