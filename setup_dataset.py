# setup_dataset.py
# This script sets up the sample face dataset for testing.
# It creates placeholder text files in each person's folder,
# explaining what real photos should go there.
# 
# For actual use: Replace the contents of sample_dataset/personX/
# with real photos of your team members.
#
# Written by: Team FEP-CS-2024

import os
import json

DATASET_DIR = os.path.join(os.path.dirname(__file__), "sample_dataset")

# Information about each person in the dataset
PEOPLE = [
    {"folder": "person1", "voter_id": "V001", "name": "Person One"},
    {"folder": "person2", "voter_id": "V002", "name": "Person Two"},
    {"folder": "person3", "voter_id": "V003", "name": "Person Three"},
    {"folder": "person4", "voter_id": "V004", "name": "Person Four"},
]


def create_readme_for_person(folder_path, person_info):
    """Create a README file in each person's folder explaining what to put there."""
    readme_content = f"""FACE DATASET - {person_info['name']}
Voter ID: {person_info['voter_id']}
========================================

This folder should contain 15-20 photos of {person_info['name']}.

HOW TO ADD PHOTOS:
------------------
1. Take 15-20 clear photos of {person_info['name']}
2. Make sure the face is clearly visible and well-lit
3. Include photos from slightly different angles
4. Save them as JPG or PNG files
5. Name them like: photo1.jpg, photo2.jpg, etc.

PHOTO REQUIREMENTS:
------------------
- Good lighting (avoid shadows on face)
- Face clearly visible (no sunglasses, mask)
- Resolution: at least 200x200 pixels
- File format: .jpg or .png

NOTE:
-----
For the college project demo, you can use photos taken on a phone.
The face_recognition library will process these to create face encodings.

After adding photos, run: python init_db.py
"""
    with open(os.path.join(folder_path, "README.txt"), "w") as f:
        f.write(readme_content)
    print(f"  Created README for {person_info['name']}")


def create_info_json(folder_path, person_info):
    """Create an info.json file with person details."""
    info = {
        "voter_id": person_info["voter_id"],
        "name": person_info["name"],
        "photos_required": 15,
        "photos_present": 0,
        "note": "Replace this folder contents with real photos of the voter"
    }
    with open(os.path.join(folder_path, "info.json"), "w") as f:
        json.dump(info, f, indent=4)
    print(f"  Created info.json for {person_info['name']}")


def check_existing_photos(folder_path):
    """Count how many actual image files exist in a folder."""
    if not os.path.exists(folder_path):
        return 0
    count = sum(1 for f in os.listdir(folder_path)
                if f.lower().endswith((".jpg", ".jpeg", ".png")))
    return count


def setup_dataset():
    """Main function to set up the dataset folders."""
    print("=" * 50)
    print("Setting up Face Recognition Dataset")
    print("=" * 50)
    
    os.makedirs(DATASET_DIR, exist_ok=True)
    
    for person in PEOPLE:
        folder_path = os.path.join(DATASET_DIR, person["folder"])
        os.makedirs(folder_path, exist_ok=True)
        
        print(f"\nSetting up: {person['name']} ({person['voter_id']})")
        
        # Count existing photos
        photo_count = check_existing_photos(folder_path)
        
        if photo_count > 0:
            print(f"  Found {photo_count} existing photos - OK!")
        else:
            print(f"  No photos found. Creating placeholder files...")
            create_readme_for_person(folder_path, person)
            create_info_json(folder_path, person)
    
    print("\n" + "=" * 50)
    print("Dataset setup complete!")
    print("=" * 50)
    print("\nIMPORTANT: Next Steps:")
    print("-" * 30)
    for person in PEOPLE:
        photo_count = check_existing_photos(os.path.join(DATASET_DIR, person["folder"]))
        status = f"{photo_count} photos (ready)" if photo_count >= 5 else "NEEDS PHOTOS"
        print(f"  sample_dataset/{person['folder']}/ - {person['name']} - {status}")
    
    print("\nAdd 15-20 photos of each person to their folder,")
    print("then run: python init_db.py")


if __name__ == "__main__":
    setup_dataset()
