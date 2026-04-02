/* ---------------------------------------------
    Prescription / File Upload Handler
----------------------------------------------*/

document.addEventListener("DOMContentLoaded", () => {
    const fileInput = document.getElementById("prescriptionFile"); // Matches your index.html ID
    const resultContainer = document.getElementById("results");    // Matches your index.html ID

    if (fileInput) {
        fileInput.addEventListener("change", handleFileSelection);
    }
});

/* ---------------------------------------------
    Read and Send Uploaded File
----------------------------------------------*/
function handleFileSelection(event) {
    const file = event.target.files[0];
    const resultContainer = document.getElementById("results");

    if (!file) return;

    // Show loading state for the doctor
    resultContainer.innerHTML = `
        <div class="status-msg loading">
            ⏳ BioBERT is scanning ${file.name} for herb-drug interactions...
        </div>`;

    const reader = new FileReader();

    reader.onload = function (e) {
        const fileContent = e.target.result;
        
        // We send the RAW text to the server so BioBERT can process the context
        sendToServer(fileContent);
    };

    reader.readAsText(file);
}

/* ---------------------------------------------
    Send Data to Backend (BioBERT Bridge)
----------------------------------------------*/
async function sendToServer(text) {
    try {
        // Updated to match your server.js route for AI analysis
        const response = await fetch("/api/analyze-text", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ text: text })
        });

        if (!response.ok) throw new Error("Server error during AI analysis");

        const data = await response.json();
        
        // Use the common render function to display results
        displayResults(data.results);
        
        // Refresh the dashboard charts since new data was added to CSV
        if (typeof loadDashboard === "function") {
            loadDashboard();
        }

    } catch (error) {
        console.error("Error:", error);
        document.getElementById("results").innerHTML = 
            "<p class='error'>❌ AI Analysis failed. Please ensure the Node server and BioBERT are running.</p>";
    }
}

/* ---------------------------------------------
    Display Interaction Results (Clinical View)
----------------------------------------------*/
function displayResults(results) {
    const resultContainer = document.getElementById("results");
    resultContainer.innerHTML = "";

    if (!results || results.length === 0) {
        resultContainer.innerHTML = "<p class='placeholder-text'>No Clinical Interactions Detected in this file.</p>";
        return;
    }

    let html = "<h3>📋 AI Clinical Detection Results</h3>";

    results.forEach(interaction => {
        // Determine CSS class based on severity
        const sevClass = (interaction.severity || "moderate").toLowerCase();

        html += `
        <div class="card ${sevClass}">
            <div class="risk-badge">${interaction.severity.toUpperCase()} RISK</div>
            <p><b>Detected Herb:</b> ${interaction.herb_raw || interaction.herb}</p>
            <p><b>Detected Drug:</b> ${interaction.drug_raw || interaction.drug}</p>
            <hr>
            <p><b>Mechanism:</b> ${interaction.mechanism || "Pending further clinical review."}</p>
            <p><b>Recommendation:</b> ${interaction.recommendation || "Consult with a healthcare provider."}</p>
        </div>
        `;
    });

    resultContainer.innerHTML = html;
}