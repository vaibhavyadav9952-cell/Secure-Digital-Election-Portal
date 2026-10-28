// vote.js - Voting page logic

// Keep track of which candidate is selected
let selectedCandidateId = null;

document.addEventListener('DOMContentLoaded', function () {
    // Set up click handlers for each candidate card
    let cards = document.querySelectorAll('.candidate-card');
    cards.forEach(function (card) {
        card.addEventListener('click', function () {
            selectCandidate(
                this.dataset.candidateId,
                this.dataset.candidateName,
                this.dataset.party
            );
        });
    });
});

// Handle candidate selection
function selectCandidate(candidateId, candidateName, party) {
    selectedCandidateId = candidateId;

    // Remove 'selected' class from all cards
    document.querySelectorAll('.candidate-card').forEach(function (card) {
        card.classList.remove('selected');
    });

    // Reset all radio circles
    document.querySelectorAll('[id^="radio_"]').forEach(function (r) {
        r.style.borderColor = '#ccc';
        r.style.backgroundColor = '';
    });

    // Add 'selected' class to the clicked card
    let clickedCard = document.querySelector(`[data-candidate-id="${candidateId}"]`);
    if (clickedCard) {
        clickedCard.classList.add('selected');
    }

    // Fill the selected radio circle
    let radio = document.getElementById('radio_' + candidateId);
    if (radio) {
        radio.style.borderColor = '#1a56db';
        radio.style.backgroundColor = '#1a56db';
    }

    // Update the hidden input with selected candidate ID
    document.getElementById('selectedCandidateId').value = candidateId;

    // Show the vote section
    document.getElementById('voteSection').style.display = 'block';
    document.getElementById('selectedCandidateName').textContent =
        candidateName + ' (' + party + ')';

    // Enable the button
    document.getElementById('castVoteBtn').disabled = false;
}

// Show confirmation before submitting vote
function confirmVote() {
    if (!selectedCandidateId) {
        alert('Please select a candidate first!');
        return;
    }

    let candidateName = document.getElementById('selectedCandidateName').textContent;
    let confirmed = confirm(
        'You are about to vote for:\n' +
        candidateName +
        '\n\nThis action CANNOT be undone.\nAre you sure you want to cast your vote?'
    );

    if (confirmed) {
        document.getElementById('voteForm').submit();
    }
}