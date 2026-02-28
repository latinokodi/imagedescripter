import requests

# Test the backend's browse endpoint
folder = r"C:\Users\ferna\OneDrive\Desktop\+ai"
resp = requests.post("http://127.0.0.1:5000/api/browse", json={"folder": folder})
data = resp.json()
print("Browse data:", data)

if data and "files" in data and len(data["files"]) > 0:
    first_file = data["files"][0]
    print(f"Attempting to fetch image: {first_file}")
    
    # Test the image endpoint
    img_resp = requests.get(f"http://127.0.0.1:5000/api/image", params={"folder": folder, "filename": first_file})
    print(f"Status Code: {img_resp.status_code}")
    print(f"Headers: {img_resp.headers}")
    print(f"Content length: {len(img_resp.content)} bytes")
