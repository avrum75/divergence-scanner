import os

root_db = "../divergence.db"
backend_db = "divergence.db"

print(f"Current CWD: {os.getcwd()}")

if os.path.exists(root_db):
    print(f"Root DB found ({root_db}): {os.path.getsize(root_db)} bytes")
else:
    print(f"Root DB NOT found at {root_db}")

if os.path.exists(backend_db):
    print(f"Backend DB found ({backend_db}): {os.path.getsize(backend_db)} bytes")
else:
    print(f"Backend DB NOT found at {backend_db}")
