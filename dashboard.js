/* ---------------------------------------------------
    Dashboard Analytics for AI-CDSS
---------------------------------------------------*/

let interactionData = [];
let charts = {}; 

async function loadDashboard() {
    console.log("📊 Dashboard: Syncing with Master Database...");
    
    try {
        // This endpoint should return the full interactionsDB from your server.js
        const API_BASE = "https://biobert-based-hdi-checker-ai-driven-cdss.onrender.com"; 
        const response = await fetch(`${API_BASE}/api/list-all`); 
        
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        
        // We use data.results because your server.js wraps the array in a results object
        interactionData = Array.isArray(data.results) ? data.results : [];

        if (interactionData.length > 0) {
            // Update Total Count UI
            const counter = document.getElementById('totalCount');
            if (counter) counter.innerText = interactionData.length;

            // Trigger Chart Rendering
            renderSeverityDistribution();
            renderTopHerbs();
            renderTopDrugClasses(); // Updated to show classes instead of just names
            console.log(`✅ Dashboard: ${interactionData.length} master records processed.`);
        } else {
            console.warn("⚠️ Dashboard: No records found.");
        }

    } catch (error) {
        console.error("❌ Dashboard Load Error:", error);
        const container = document.getElementById('dbSyncStatus');
        if (container) {
            container.innerText = "Sync Error: API Unreachable";
            container.style.background = "#d63031";
        }
    }
}

/* ---------------------------------------------------
    1. Severity Distribution Chart (Doughnut)
---------------------------------------------------*/
function renderSeverityDistribution() {
    let severityCount = { High: 0, Moderate: 0, Minor: 0 };

    interactionData.forEach(item => {
        const sev = (item.severity || "").toLowerCase();
        // Matching your CSV labels like "Minor-moderate" or "Moderate"
        if (sev.includes("severe") || sev.includes("high") || sev.includes("major")) {
            severityCount.High++;
        } else if (sev.includes("moderate")) {
            severityCount.Moderate++;
        } else {
            severityCount.Minor++;
        }
    });

    createChart("severityChart", "doughnut", {
        labels: ["High Risk", "Moderate", "Minor/Mild"],
        datasets: [{
            data: [severityCount.High, severityCount.Moderate, severityCount.Minor],
            backgroundColor: ["#e74c3c", "#f39c12", "#27ae60"],
            hoverOffset: 10
        }]
    }, "Interaction Severity Breakdown");
}

/* ---------------------------------------------------
    2. Top Herbs (Horizontal Bar)
---------------------------------------------------*/
function renderTopHerbs() {
    let herbCounts = {};
    interactionData.forEach(item => {
        // Matches the 'herb_display' field sent by our updated server.js
        const name = item.herb_display || item.herb;
        if (name) {
            herbCounts[name] = (herbCounts[name] || 0) + 1;
        }
    });

    const sortedHerbs = Object.entries(herbCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    createChart("herbChart", "bar", {
        labels: sortedHerbs.map(d => d[0]),
        datasets: [{
            label: "Total Interaction Profiles",
            data: sortedHerbs.map(d => d[1]),
            backgroundColor: "#2ecc71",
            borderRadius: 5
        }]
    }, "Top 5 Interacting Herbs", 'y'); // 'y' makes it horizontal
}

/* ---------------------------------------------------
    3. Top Drug Classes (Horizontal Bar)
---------------------------------------------------*/
function renderTopDrugClasses() {
    let classCounts = {};
    interactionData.forEach(item => {
        // Matches the 'drug_class' field from your Master CSV
        const dClass = item.drug_class || "Unclassified";
        if (dClass) {
            classCounts[dClass] = (classCounts[dClass] || 0) + 1;
        }
    });

    const sortedClasses = Object.entries(classCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    createChart("drugChart", "bar", {
        labels: sortedClasses.map(d => d[0]),
        datasets: [{
            label: "Records per Class",
            data: sortedClasses.map(d => d[1]),
            backgroundColor: "#3498db",
            borderRadius: 5
        }]
    }, "High-Risk Drug Classes", 'y');
}

/* ---------------------------------------------------
    Helper: Universal Chart Creator
---------------------------------------------------*/
function createChart(canvasId, type, data, title, indexAxis = 'x') {
    const canvasElement = document.getElementById(canvasId);
    if (!canvasElement) return;

    const ctx = canvasElement.getContext('2d');

    if (charts[canvasId]) {
        charts[canvasId].destroy();
    }

    charts[canvasId] = new Chart(ctx, {
        type: type,
        data: data,
        options: {
            indexAxis: indexAxis, 
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: title, font: { size: 14, weight: 'bold' } },
                legend: { position: 'bottom' }
            },
            scales: type === 'bar' ? { 
                x: { beginAtZero: true, ticks: { stepSize: 1 } }
            } : {}
        }
    });
}

// Start
window.addEventListener('DOMContentLoaded', loadDashboard);
