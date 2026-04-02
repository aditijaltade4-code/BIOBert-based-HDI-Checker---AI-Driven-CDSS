/* ---------------------------------------------------
    Dashboard Analytics for AI-CDSS
---------------------------------------------------*/

let interactionData = [];
let charts = {}; // Object to store chart instances

async function loadDashboard() {
    console.log("📊 Dashboard: Fetching latest clinical data...");
    
    // Ensure we have a clean slate in the UI
    const container = document.getElementById('results');
    
    try {
        // Updated fetch to match the fixed server route
        const response = await fetch("/api/list-all"); 
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        // Ensure data.results exists and is an array
        interactionData = Array.isArray(data.results) ? data.results : [];

        if (interactionData.length > 0) {
            // Update Total Count UI
            const counter = document.getElementById('totalCount');
            if (counter) counter.innerText = interactionData.length;

            // Trigger Chart Rendering
            renderSeverityDistribution();
            renderTopHerbs();
            renderTopDrugs();
            console.log(`✅ Dashboard: ${interactionData.length} records rendered.`);
        } else {
            console.warn("⚠️ Dashboard: CSV is empty or backend returned no records.");
            if (container) container.innerHTML = "<p>No interaction records found in database.</p>";
        }

    } catch (error) {
        console.error("❌ Dashboard Load Error:", error);
        if (container) {
            container.innerHTML = `<p style='color:red; font-weight:bold;'>
                Connection Error: Could not connect to API server. 
                <br><small>Details: ${error.message}</small>
            </p>`;
        }
    }
}

/* ---------------------------------------------------
    1. Severity Distribution Chart (Pie)
---------------------------------------------------*/
function renderSeverityDistribution() {
    let severityCount = { High: 0, Moderate: 0, Minor: 0 };

    interactionData.forEach(item => {
        // Robust severity checking (handles 3, "High", "Severe", etc.)
        const sev = (item.severity || "").toString().toLowerCase();
        if (sev.includes("severe") || sev.includes("high") || sev.includes("3") || sev.includes("major")) {
            severityCount.High++;
        } else if (sev.includes("moderate") || sev.includes("2")) {
            severityCount.Moderate++;
        } else {
            severityCount.Minor++;
        }
    });

    createChart("severityChart", "pie", {
        labels: ["High Risk", "Moderate", "Minor/Mild"],
        datasets: [{
            data: [severityCount.High, severityCount.Moderate, severityCount.Minor],
            backgroundColor: ["#e74c3c", "#f39c12", "#27ae60"],
            borderWidth: 1
        }]
    }, "Risk Severity Distribution");
}

/* ---------------------------------------------------
    2. Top Herbs (Vertical Bar)
---------------------------------------------------*/
function renderTopHerbs() {
    let herbCounts = {};
    interactionData.forEach(item => {
        // Use raw name if available, fallback to normalized
        const name = item.herb_raw || item.herb;
        if (name) {
            const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
            herbCounts[capitalized] = (herbCounts[capitalized] || 0) + 1;
        }
    });

    const sortedHerbs = Object.entries(herbCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    createChart("herbChart", "bar", {
        labels: sortedHerbs.map(d => d[0]),
        datasets: [{
            label: "Total Interactions",
            data: sortedHerbs.map(d => d[1]),
            backgroundColor: "#4CAF50",
            borderRadius: 5
        }]
    }, "Most Frequent Herbs");
}

/* ---------------------------------------------------
    3. Top Drugs (Vertical Bar)
---------------------------------------------------*/
function renderTopDrugs() {
    let drugCounts = {};
    interactionData.forEach(item => {
        const name = item.drug_raw || item.drug;
        if (name) {
            const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
            drugCounts[capitalized] = (drugCounts[capitalized] || 0) + 1;
        }
    });

    const sortedDrugs = Object.entries(drugCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    createChart("drugChart", "bar", {
        labels: sortedDrugs.map(d => d[0]),
        datasets: [{
            label: "Total Interactions",
            data: sortedDrugs.map(d => d[1]),
            backgroundColor: "#2196F3",
            borderRadius: 5
        }]
    }, "Most Frequent Drugs");
}

/* ---------------------------------------------------
    Helper: Universal Chart Creator
---------------------------------------------------*/
function createChart(canvasId, type, data, title) {
    const canvasElement = document.getElementById(canvasId);
    if (!canvasElement) {
        console.error(`Missing Canvas ID: ${canvasId}`);
        return;
    }

    const ctx = canvasElement.getContext('2d');

    // Destroy existing chart instance to prevent tooltips from overlapping
    if (charts[canvasId]) {
        charts[canvasId].destroy();
    }

    charts[canvasId] = new Chart(ctx, {
        type: type,
        data: data,
        options: {
            indexAxis: 'x', // Ensures bars are vertical
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: title, font: { size: 16 } },
                legend: { position: type === 'pie' ? 'bottom' : 'top' }
            },
            scales: type === 'bar' ? { 
                y: { beginAtZero: true, ticks: { stepSize: 1 } },
                x: { ticks: { autoSkip: false } }
            } : {}
        }
    });
}

// Initial Load
window.addEventListener('DOMContentLoaded', loadDashboard);