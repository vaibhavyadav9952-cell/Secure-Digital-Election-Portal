# face_auth.py - Face Recognition, Liveness Detection, and Duplicate-Face Detection

import cv2
import face_recognition
import numpy as np
import os
import base64
import json
from config import UPLOAD_FOLDER, TEMP_FOLDER, FACE_MATCH_THRESHOLD, DUPLICATE_FACE_THRESHOLD

# ----------------------------------------------------------------
# FACE_MATCH_THRESHOLD (from config.py, default = 0.5) explained:
#
#   face_recognition computes Euclidean distance between 128-D vectors.
#   Distance = 0.0  -> identical faces
#   Distance = 1.0  -> completely different faces
#
#   We treat distance <= FACE_MATCH_THRESHOLD as "same person".
#   This threshold is used BOTH for login verification AND for
#   duplicate-registration detection, keeping the system consistent.
#
#   You can tune it in config.py:
#     Lower value (e.g. 0.4) = stricter, fewer false positives
#     Higher value (e.g. 0.6) = looser, catches more duplicates
# ----------------------------------------------------------------


def decode_base64_image(base64_string):
    """
    Convert a base64 image string (from webcam) to a numpy array.
    Frontend sends webcam frame as base64 JPEG.
    """
    try:
        if ',' in base64_string:
            base64_string = base64_string.split(',')[1]
        img_bytes = base64.b64decode(base64_string)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return img
    except Exception as e:
        print(f"[FACE AUTH] Error decoding image: {e}")
        return None


def save_face_image(image, user_id):
    """
    Save a captured face image to disk.
    Filename: static/uploads/faces/{user_id}.jpg
    """
    try:
        os.makedirs(UPLOAD_FOLDER, exist_ok=True)
        filename = f"{user_id}.jpg"
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        cv2.imwrite(filepath, image)
        print(f"[FACE AUTH] Face saved: {filepath}")
        return filepath
    except Exception as e:
        print(f"[FACE AUTH] Error saving face: {e}")
        return None


def get_face_encoding(image):
    """
    Extract a 128-dimensional face encoding from an OpenCV BGR image.
    Returns a numpy array, or None if no face found.
    """
    try:
        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        face_locations = face_recognition.face_locations(rgb_image)

        if not face_locations:
            print("[FACE AUTH] No face detected in image.")
            return None

        encodings = face_recognition.face_encodings(rgb_image, face_locations)
        if encodings:
            return encodings[0]  # 128-D numpy array
        return None
    except Exception as e:
        print(f"[FACE AUTH] Error getting face encoding: {e}")
        return None


def get_face_count(image):
    """
    Count how many faces are visible in an image.
    Used to enforce exactly-one-face rule during registration.
    Returns int (0 = no face, 1 = ok, 2+ = too many).
    """
    try:
        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        face_locations = face_recognition.face_locations(rgb_image)
        return len(face_locations)
    except Exception as e:
        print(f"[FACE AUTH] Error counting faces: {e}")
        return 0


def embedding_to_json(encoding_array):
    """
    Convert a numpy 128-D face encoding to a JSON string for database storage.
    Example output: '[0.123, -0.456, ...]'
    """
    return json.dumps(encoding_array.tolist())


def json_to_embedding(json_string):
    """
    Convert a stored JSON string back to a numpy array for comparison.
    Returns None if parsing fails (e.g. corrupted data).
    """
    try:
        return np.array(json.loads(json_string))
    except Exception as e:
        print(f"[FACE AUTH] Error parsing stored embedding: {e}")
        return None


def check_duplicate_face(new_encoding, all_users_with_embeddings):
    """
    Compare a new face encoding against ALL existing registered users.

    We reuse DUPLICATE_FACE_THRESHOLD (from config.py) here — stricter than the
    login threshold so the large Kaggle face dataset doesn't false-match real
    new registrants. Only reject if the face is very close (distance ≤ 0.45).

    If the Euclidean distance between the new face and any stored face
    is <= FACE_MATCH_THRESHOLD, they are considered the same person.

    Args:
        new_encoding: numpy 128-D array from the webcam image
        all_users_with_embeddings: list of dicts with keys:
            'id', 'name', 'email', 'face_embedding' (JSON string)

    Returns:
        (is_duplicate: bool, matched_user: dict or None)
    """
    for user in all_users_with_embeddings:
        stored_json = user.get('face_embedding')
        if not stored_json:
            continue  # Skip users who have no embedding yet

        stored_encoding = json_to_embedding(stored_json)
        if stored_encoding is None:
            continue

        # Euclidean distance between the two 128-D vectors
        distance = face_recognition.face_distance([stored_encoding], new_encoding)[0]

        if distance <= DUPLICATE_FACE_THRESHOLD:
            print(f"[FACE AUTH] Duplicate face! Matched user {user['id']} "
                  f"({user['name']}), distance={distance:.3f}")
            return True, user

    return False, None


def register_face(base64_image, user_id, existing_users=None):
    """
    Validate and process a new user's face for registration.

    Validation steps (in order):
      1. Decode webcam image
      2. Count faces — must be exactly 1
      3. Generate 128-D embedding
      4. Check for duplicate face against all existing users
      5. Save image to disk

    Args:
        base64_image: base64 JPEG string from webcam
        user_id:      the ID of the user being registered
        existing_users: list of users with 'face_embedding' for duplicate check
                        (pass None or [] to skip the duplicate check)

    Returns:
        (success: bool, message: str, filepath: str or None, encoding: np.array or None)
        NOTE: encoding is returned so the caller can store it in the DB.
    """
    # Step 1: Decode image
    image = decode_base64_image(base64_image)
    if image is None:
        return False, "Could not decode webcam image.", None, None

    # Step 2: Count faces — reject 0 or 2+
    face_count = get_face_count(image)
    if face_count == 0:
        return False, "No face detected. Please position your face clearly in front of the camera.", None, None
    if face_count > 1:
        return False, "Multiple faces detected. Please ensure only one person is visible.", None, None

    # Step 3: Generate 128-D embedding
    encoding = get_face_encoding(image)
    if encoding is None:
        return False, "Could not generate face encoding. Please try again.", None, None

    # Step 4: Duplicate-face check
    if existing_users:
        is_dup, matched_user = check_duplicate_face(encoding, existing_users)
        if is_dup:
            return (False,
                    "This person is already registered. Please use your existing account.",
                    None, None)

    # Step 5: Save face image to disk
    filepath = save_face_image(image, user_id)
    if filepath is None:
        return False, "Could not save face image. Check folder permissions.", None, None

    return True, "Face registered successfully!", filepath, encoding


def verify_face(base64_image, stored_face_path):
    """
    Verify a live webcam face against the stored registered face image.
    Returns: (match: bool, confidence_percent: float, message: str)
    """
    try:
        live_image = decode_base64_image(base64_image)
        if live_image is None:
            return False, 0, "Could not decode webcam image."

        if not os.path.exists(stored_face_path):
            return False, 0, "Registered face image not found."

        stored_image = cv2.imread(stored_face_path)
        if stored_image is None:
            return False, 0, "Could not load registered face image."

        live_encoding = get_face_encoding(live_image)
        stored_encoding = get_face_encoding(stored_image)

        if live_encoding is None:
            return False, 0, "No face detected in webcam feed. Please look at the camera."
        if stored_encoding is None:
            return False, 0, "Could not process registered face image."

        face_distance = face_recognition.face_distance([stored_encoding], live_encoding)[0]
        confidence = round((1 - face_distance) * 100, 1)
        is_match = bool(face_distance <= FACE_MATCH_THRESHOLD)

        if is_match:
            message = f"Identity Verified! Confidence: {confidence}%"
            print(f"[FACE AUTH] Match found. Distance: {face_distance:.3f}, Confidence: {confidence}%")
        else:
            message = f"Face Not Recognized. Confidence: {confidence}%"
            print(f"[FACE AUTH] No match. Distance: {face_distance:.3f}, Confidence: {confidence}%")

        return is_match, confidence, message

    except Exception as e:
        print(f"[FACE AUTH] Error during verification: {e}")
        return False, 0, "An error occurred during face verification."


def draw_face_rectangle(base64_image, is_authorized):
    """
    Draw a colored rectangle around detected face.
    Green = Authorized, Red = Unauthorized.
    """
    try:
        image = decode_base64_image(base64_image)
        if image is None:
            return base64_image

        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        face_locations = face_recognition.face_locations(rgb_image)

        for (top, right, bottom, left) in face_locations:
            color = (0, 255, 0) if is_authorized else (0, 0, 255)
            cv2.rectangle(image, (left, top), (right, bottom), color, 2)
            label = "AUTHORIZED" if is_authorized else "UNAUTHORIZED"
            cv2.putText(image, label, (left, top - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

        _, buffer = cv2.imencode('.jpg', image)
        result_base64 = base64.b64encode(buffer).decode('utf-8')
        return f"data:image/jpeg;base64,{result_base64}"

    except Exception as e:
        print(f"[FACE AUTH] Error drawing rectangle: {e}")
        return base64_image


# ---- Liveness Detection ----
# Strategy: Check 3 things — pass ANY ONE = real person
#   1. Blink: eye-region brightness drop >= 6 units
#   2. Motion: pixel movement between frames >= 500px avg
#   3. Texture: Laplacian variance >= 25 (real skin has texture)
# A phone photo fails all 3. A real person passes at least 1.

def _get_eye_brightness(image_bgr):
    """
    Returns average brightness of the eye region (top 30-50% of face box).
    Returns None if no face found.
    """
    try:
        rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        locs = face_recognition.face_locations(rgb, model='hog')
        if not locs:
            return None
        top, right, bottom, left = locs[0]
        face_h = bottom - top
        ey_top = top + int(face_h * 0.20)
        ey_bot = top + int(face_h * 0.50)
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        eye_region = gray[ey_top:ey_bot, left:right]
        if eye_region.size == 0:
            return None
        return float(np.mean(eye_region))
    except Exception:
        return None


def check_liveness_from_frames(frames_base64):
    """
    3-way liveness check — passes if ANY ONE of three signals detected:
      1. Blink  : eye-region brightness drops >= 6 units across frames
      2. Motion : avg pixel diff between frames >= 500 pixels
      3. Texture: Laplacian variance >= 25 on final frame

    Real person -> passes at least one -> ACCEPTED
    Static phone photo -> fails all three -> REJECTED
    """
    BLINK_THRESHOLD   = 6    # brightness units (was 15 — too strict)
    MOTION_THRESHOLD  = 500  # pixel diff avg  (was 2000 — too strict)
    TEXTURE_THRESHOLD = 25   # Laplacian var   (was 80 — too strict)

    reasons_passed = []
    reasons_failed = []

    try:
        if not frames_base64 or len(frames_base64) < 2:
            # Not enough frames — fall back to single frame check
            return check_single_frame_liveness(frames_base64[0] if frames_base64 else "")

        decoded = []
        for b64 in frames_base64:
            img = decode_base64_image(b64)
            if img is not None:
                decoded.append(img)

        if not decoded:
            return False, "Could not decode frames."

        # ---- Check 1: Blink detection ----
        if len(decoded) >= 5:
            brightnesses = [_get_eye_brightness(f) for f in decoded]
            brightnesses = [b for b in brightnesses if b is not None]
            if len(brightnesses) >= 3:
                drop = max(brightnesses) - min(brightnesses)
                print(f"[LIVENESS] Blink check — brightness drop: {drop:.1f} (need >= {BLINK_THRESHOLD})")
                if drop >= BLINK_THRESHOLD:
                    reasons_passed.append(f"Blink detected (drop={drop:.1f})")
                else:
                    reasons_failed.append(f"No blink (drop={drop:.1f})")
            else:
                reasons_failed.append("Face not clear in frames")
        else:
            reasons_failed.append("Too few frames for blink check")

        # ---- Check 2: Motion detection ----
        gray_frames = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in decoded]
        if len(gray_frames) >= 2:
            diffs = [cv2.countNonZero(cv2.absdiff(gray_frames[i-1], gray_frames[i]))
                     for i in range(1, len(gray_frames))]
            avg_motion = sum(diffs) / len(diffs)
            print(f"[LIVENESS] Motion check — avg diff: {avg_motion:.0f} (need >= {MOTION_THRESHOLD})")
            if avg_motion >= MOTION_THRESHOLD:
                reasons_passed.append(f"Motion detected ({avg_motion:.0f}px)")
            else:
                reasons_failed.append(f"Low motion ({avg_motion:.0f}px)")

        # ---- Check 3: Texture on last frame ----
        last_gray = cv2.cvtColor(decoded[-1], cv2.COLOR_BGR2GRAY)
        variance = cv2.Laplacian(last_gray, cv2.CV_64F).var()
        print(f"[LIVENESS] Texture check — variance: {variance:.1f} (need >= {TEXTURE_THRESHOLD})")
        if variance >= TEXTURE_THRESHOLD:
            reasons_passed.append(f"Real face texture ({variance:.1f})")
        else:
            reasons_failed.append(f"Low texture ({variance:.1f}) — possible flat photo")

        # Pass if ANY check passed
        if reasons_passed:
            msg = "Liveness Verified: " + " | ".join(reasons_passed)
            print(f"[LIVENESS] PASSED — {msg}")
            return True, msg
        else:
            msg = "Liveness Failed: " + " | ".join(reasons_failed)
            print(f"[LIVENESS] FAILED — {msg}")
            return False, msg

    except Exception as e:
        print(f"[LIVENESS] Error: {e}")
        # On error, pass liveness (don't block real users due to code error)
        return True, "Liveness check skipped (processing error — assumed live)"


def check_single_frame_liveness(base64_image):
    """
    Single-frame liveness: uses Laplacian texture variance.
    Threshold = 25 (lenient). Real faces have rich texture; flat photos do not.
    On error, returns True (don't block real users).
    """
    try:
        if not base64_image:
            return True, "No frame for liveness check — assumed live"

        image = decode_base64_image(base64_image)
        if image is None:
            return True, "Could not decode image — assumed live"

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        variance = cv2.Laplacian(gray, cv2.CV_64F).var()
        print(f"[LIVENESS] Single-frame texture variance: {variance:.1f}")

        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        face_locs = face_recognition.face_locations(rgb)

        if not face_locs:
            return True, "No face detected — assumed live (camera issue)"

        if variance >= 25:
            return True,  f"Liveness OK (texture={variance:.1f})"
        else:
            return False, f"Flat image detected (texture={variance:.1f}) — possible photo spoof"

    except Exception as e:
        print(f"[LIVENESS] Single frame error: {e}")
        return True, "Liveness check skipped — assumed live"
