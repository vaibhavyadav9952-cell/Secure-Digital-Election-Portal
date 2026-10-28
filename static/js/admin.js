// admin.js - Admin panel interactions

document.addEventListener('DOMContentLoaded', function() {
    // Mark active nav link based on current URL
    highlightActiveNavLink();
});

function highlightActiveNavLink() {
    let currentPath = window.location.pathname;
    let navLinks = document.querySelectorAll('.admin-sidebar .nav-link');

    navLinks.forEach(function(link) {
        if (link.getAttribute('href') === currentPath) {
            link.classList.add('active');
        }
    });
}

// Blockchain verification
async function verifyBlockchain() {
    let btn = document.getElementById('verifyChainBtn');
    let resultDiv = document.getElementById('verifyResult');

    if (btn) btn.disabled = true;
    if (resultDiv) resultDiv.textContent = 'Verifying...';

    try {
        let response = await fetch('/api/verify-blockchain');
        let data = await response.json();

        if (resultDiv) {
            if (data.is_valid) {
                resultDiv.innerHTML = '<span style="color:green;">&#10003; ' + data.message + '</span>';
            } else {
                resultDiv.innerHTML = '<span style="color:red;">&#10007; ' + data.message + '</span>';
            }
        }
    } catch (err) {
        if (resultDiv) resultDiv.textContent = 'Error: Could not verify blockchain.';
    }

    if (btn) btn.disabled = false;
}

// Search users table
function searchUsers() {
    let input = document.getElementById('userSearchInput').value.toLowerCase();
    let rows = document.querySelectorAll('#usersTable tbody tr');

    rows.forEach(function(row) {
        let text = row.textContent.toLowerCase();
        row.style.display = text.includes(input) ? '' : 'none';
    });
}

// Confirm election toggle (if needed)
function confirmToggleElection() {
    return confirm('Are you sure you want to change the election status?');
}
