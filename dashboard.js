/* ---------------------------------------------------
    Dashboard Analytics for AI-CDSS (Fixed)
---------------------------------------------------*/

let interactionData = [];
let charts = {}; 

async function loadDashboard() {
    console.log("📊 Dashboard: Syncing with Master Database...");
    const statusContainer = document.getElementById('dbSyncStatus');
    
    try {
        // API Base URL
        const API_BASE = "https://biobert-based-hdi-checker-ai-driven-cdss.onrender.com"; 
        
        // Added a timestamp (?t=...) to prevent browser caching of empty results
        const response = await fetch(`${API_BASE}/api/list-all?t=${Date.now()}`); 
        
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        
        /**
         * FIX: Server logic check
         * Your server sends 'interactionsDB' directly as an array.
         * We check for both 'data' and 'data.results' just in case.
         */
        interactionData = Array.isArray(data) ? data : (data.results || []);

        if (interactionData.length > 0) {
            // Update Total Count UI
            const counter = document.getElementById('totalCount');
            if (counter) counter.innerText = interactionData.length;

            // Update Status Badge
            if (statusContainer) {
                statusContainer.innerText = "Database Synced";
                statusContainer.style.background = "#27ae60"; // Green
            }

            // Trigger Chart Rendering
            renderSeverityDistribution();
            renderTopHerbs();
            renderTopDrugClasses(); 
            console.log(`✅ Dashboard: ${interactionData.length} records processed.`);
        } else {
            console.warn("⚠️ Dashboard: Server connected but database is empty.");
            if (statusContainer) {
                statusContainer.innerText = "Database Empty";
                statusContainer.style.background = "#f39c12"; // Orange
            }
        }

    } catch (error) {
        console.error("❌ Dashboard Load Error:", error);
        if (statusContainer) {
            statusContainer.innerText = "Sync Error: API Unreachable";
            statusContainer.style.background = "#d63031"; // Red
        }
    }
}

/* ---------------------------------------------------
    1. Severity Distribution Chart (Doughnut)
---------------------------------------------------*/
function renderSeverityDistribution() {
    let severityCount = { High: 0, Moderate: 0, Minor: 0 };

    interactionData.forEach(item => {
        // We check clinical_effect or severity column
        const sev = (item.severity || item.clinical_effect || "").toLowerCase();
        
        if (sev.includes("severe") || sev.includes("high") || sev.includes("major") || sev.includes("contraindicated")) {
            severityCount.High++;
        } else if (sev.includes("moderate") || sev.includes("monitor")) {
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
        // Normalize names to title case for cleaner charts
        let name = item.herb || "Unknown Herb";
        name = name.charAt(0).toUpperCase() + name.slice(1);
        
        herbCounts[name] = (herbCounts[name] || 0) + 1;
    });

    const sortedHerbs = Object.entries(herbCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    createChart("herbChart", "bar", {
        labels: sortedHerbs.map(d => d[0]),
        datasets: [{
            label: "Interaction Profiles",
            data: sortedHerbs.map(d => d[1]),
            backgroundColor: "#2ecc71",
            borderRadius: 5
        }]
    }, "Top 5 Interacting Herbs", 'y'); 
}

/* ---------------------------------------------------
    3. Top Drug Classes (Horizontal Bar)
---------------------------------------------------*/
function renderTopDrugClasses() {
    let classCounts = {};
    interactionData.forEach(item => {
        // Try to find drug_class, fallback to drug name
        const dClass = item.drug_class || item.drug || "Unclassified";
        const normalizedClass = dClass.charAt(0).toUpperCase() + dClass.slice(1);
        classCounts[normalizedClass] = (classCounts[normalizedClass] || 0) + 1;
    });

    const sortedClasses = Object.entries(classCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    createChart("drugChart", "bar", {
        labels: sortedClasses.map(d => d[0]),
        datasets: [{
            label: "Records per Class/Drug",
            data: sortedClasses.map(d => d[1]),
            backgroundColor: "#3498db",
            borderRadius: 5
        }]
    }, "High-Risk Drugs/Classes", 'y');
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

// Initialize
window.addEventListener('DOMContentLoaded', loadDashboard);
