// charts.js - Chart.js graphs for the results page

// Wait for DOM to load before drawing charts
document.addEventListener('DOMContentLoaded', function() {
    loadChartData();
});

// Load vote data from the server API
async function loadChartData() {
    try {
        let response = await fetch('/api/results-data');
        let data = await response.json();

        if (data && data.labels && data.votes) {
            drawBarChart(data);
            drawPieChart(data);
        }
    } catch (err) {
        console.error('Could not load chart data:', err);
        document.getElementById('chartError').style.display = 'block';
    }
}

// Draw bar chart showing votes per candidate
function drawBarChart(data) {
    let ctx = document.getElementById('barChart').getContext('2d');

    // Basic colors - not too fancy
    let barColors = ['#1a56db', '#16a34a', '#dc2626', '#d97706', '#7c3aed'];

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.labels,
            datasets: [{
                label: 'Number of Votes',
                data: data.votes,
                backgroundColor: barColors.slice(0, data.labels.length),
                borderColor: barColors.slice(0, data.labels.length),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: true,
                    text: 'Votes per Candidate',
                    font: { size: 16 }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    },
                    title: {
                        display: true,
                        text: 'Number of Votes'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Candidates'
                    }
                }
            }
        }
    });
}

// Draw pie chart showing vote distribution
function drawPieChart(data) {
    let ctx = document.getElementById('pieChart').getContext('2d');

    let pieColors = ['#1a56db', '#16a34a', '#dc2626', '#d97706', '#7c3aed'];

    new Chart(ctx, {
        type: 'pie',
        data: {
            labels: data.labels,
            datasets: [{
                data: data.votes,
                backgroundColor: pieColors.slice(0, data.labels.length),
                borderColor: '#fff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                },
                title: {
                    display: true,
                    text: 'Vote Distribution',
                    font: { size: 16 }
                }
            }
        }
    });
}
