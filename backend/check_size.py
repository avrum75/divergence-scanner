import os

db_path = "/Users/avi/Dev/Divergence Scanner/backend/divergence.db"
out_path = "/Users/avi/Dev/Divergence Scanner/backend/size.txt"

if os.path.exists(db_path):
    size = os.path.getsize(db_path)
    with open(out_path, "w") as f:
        f.write(f"Size: {size}")
else:
    with open(out_path, "w") as f:
        f.write("Not found")
