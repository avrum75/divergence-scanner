import os

search_root = "/Users/avi/Dev/Divergence Scanner"
out_path = os.path.join(search_root, "backend/all_dbs.txt")

found = []
for root, dirs, files in os.walk(search_root):
    for file in files:
        if file.endswith(".db"):
            full_path = os.path.join(root, file)
            size = os.path.getsize(full_path)
            found.append(f"{full_path} ({size} bytes)")

with open(out_path, "w") as f:
    f.write("\n".join(found) if found else "No .db files found")
