// login.js - Webcam face capture for Login page

// Global variables
let videoStream = null;
let video = null;
let canvas = null;
let capturedImage = null;
let livenessFrames = [];
let frameInterval = null;
let isCapturing = false;

// Called when page loads
document.addEventListener('DOMContentLoaded', function() {
    video = document.getElementById('cameraFeed');
    canvas = document.getElementById('captureCanvas');

    // Start camera automatically
    startCamera();
});

// Start the webcam
async function startCamera() {
    try {
        // Request access to webcam
        videoStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 400, height: 300, facingMode: 'user' }
        });

        video.srcObject = videoStream;
        video.play();

        showMessage('Camera started. Please look at the camera.', 'info');
        document.getElementById('captureBtn').disabled = false;

        // Start collecting frames for liveness detection in background
        startLivenessFrameCollection();

    } catch (err) {
        console.error('Camera error:', err);
        showMessage('Camera Not Available. Please allow camera access and refresh.', 'danger');
        document.getElementById('captureBtn').disabled = true;
    }
}

// Collect frames in background for liveness (blink) detection
function startLivenessFrameCollection() {
    livenessFrames = [];

    // Show BLINK NOW banner after 2s to prompt real blink
    setTimeout(() => {
        let banner = document.getElementById('blinkBanner');
        if (banner) {
            banner.style.display = 'block';
            showMessage('\uD83D\uDC41 BLINK NOW \u2014 then click Capture & Verify', 'warning');
        }
    }, 2000);

    // Capture a frame every 100ms (10fps) - catches blinks properly
    frameInterval = setInterval(() => {
        if (video && video.readyState === 4) {
            let tempCanvas = document.createElement('canvas');
            tempCanvas.width = 320;
            tempCanvas.height = 240;
            tempCanvas.getContext('2d').drawImage(video, 0, 0, 320, 240);
            livenessFrames.push(tempCanvas.toDataURL('image/jpeg', 0.5));
            // Keep last 30 frames (3 seconds worth)
            if (livenessFrames.length > 30) livenessFrames.shift();
        }
    }, 100);
}

// Capture a photo from the webcam
function capturePhoto() {
    if (!video || !canvas) {
        showMessage('Camera not ready.', 'danger');
        return;
    }

    // Draw video frame to canvas
    canvas.width = video.videoWidth || 400;
    canvas.height = video.videoHeight || 300;
    let ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Get the image as base64
    capturedImage = canvas.toDataURL('image/jpeg', 0.9);

    // Show the captured image preview
    document.getElementById('capturedPreview').src = capturedImage;
    document.getElementById('previewSection').style.display = 'block';

    showMessage('Photo captured! Click "Verify Face" to continue.', 'info');
    document.getElementById('verifyBtn').disabled = false;
}

// Send captured image to server for face verification
async function verifyFace() {
    if (!capturedImage) {
        showMessage('Please capture a photo first.', 'warning');
        return;
    }

    // Stop frame collection
    if (frameInterval) {
        clearInterval(frameInterval);
    }

    showMessage('Verifying your face... Please wait.', 'info');
    document.getElementById('verifyBtn').disabled = true;
    document.getElementById('loadingSpinner').style.display = 'block';

    try {
        // Send image and liveness frames to server
        let response = await fetch('/api/verify-face', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: capturedImage,
                liveness_frames: livenessFrames
            })
        });

        let data = await response.json();

        document.getElementById('loadingSpinner').style.display = 'none';

        if (data.success) {
            // Show success result
            showResult(true, data.message, data.confidence, data.risk_score, data.risk_level, data.liveness_message);

            // Show risk score bar
            updateRiskBar(data.risk_score);

            // Redirect to dashboard after 2 seconds
            setTimeout(() => {
                window.location.href = data.redirect || '/dashboard';
            }, 2500);
        } else {
            // Show failure result
            showResult(false, data.message, data.confidence, data.risk_score, data.risk_level, data.liveness_message);
            updateRiskBar(data.risk_score);

            // Re-enable capture button so user can try again
            document.getElementById('verifyBtn').disabled = false;
            startLivenessFrameCollection();
        }

    } catch (err) {
        console.error('Verification error:', err);
        document.getElementById('loadingSpinner').style.display = 'none';
        showMessage('Network error. Please check your connection and try again.', 'danger');
        document.getElementById('verifyBtn').disabled = false;
    }
}

// Show verification result on screen
function showResult(success, message, confidence, riskScore, riskLevel, livenessMsg) {
    let resultDiv = document.getElementById('verificationResult');
    resultDiv.style.display = 'block';

    if (success) {
        resultDiv.innerHTML = `
            <div class="alert alert-success">
                <strong>✅ ${message}</strong><br>
                <small>Liveness: ${livenessMsg || 'Verified'}</small><br>
                <small>Confidence: ${confidence}% | Risk: ${riskScore}/100 (${riskLevel})</small>
            </div>
        `;
    } else {
        resultDiv.innerHTML = `
            <div class="alert alert-danger">
                <strong>❌ ${message}</strong><br>
                <small>Liveness: ${livenessMsg || 'Not verified'}</small><br>
                <small>Confidence: ${confidence}% | Risk Score: ${riskScore}/100 (${riskLevel})</small>
            </div>
        `;
    }
}

// Update the risk score progress bar
function updateRiskBar(riskScore) {
    let bar = document.getElementById('riskBar');
    if (!bar) return;

    bar.style.width = riskScore + '%';

    if (riskScore <= 30) {
        bar.className = 'risk-bar safe';
    } else if (riskScore <= 60) {
        bar.className = 'risk-bar suspicious';
    } else {
        bar.className = 'risk-bar high';
    }

    document.getElementById('riskScoreText').textContent = `Fraud Risk Score: ${riskScore}/100`;
    document.getElementById('riskBarContainer').style.display = 'block';
}

// Show a message in the message box
function showMessage(msg, type) {
    let msgBox = document.getElementById('messageBox');
    if (msgBox) {
        msgBox.className = `alert alert-${type}`;
        msgBox.textContent = msg;
        msgBox.style.display = 'block';
    }
}

// Stop camera when leaving page
window.addEventListener('beforeunload', function() {
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
    }
    if (frameInterval) {
        clearInterval(frameInterval);
    }
});
