/* --------------------------------------------------
   Safety Recommendation Module
   Herb–Drug Interaction Clinical Guidance
--------------------------------------------------*/

/*
Severity Levels
Severe   → Avoid combination
Moderate → Monitor patient
Mild     → Use with caution
*/

function generateRecommendation(severity) {

    if (!severity) return "No recommendation available";

    severity = severity.toLowerCase();

    if (severity === "severe" || severity === "major") {

        return {
            action: "Avoid combination",
            clinicalAdvice: "The herb and drug should not be used together due to high risk of serious adverse effects.",
            monitoring: "Consider alternative therapy."
        };

    }

    if (severity === "moderate") {

        return {
            action: "Monitor patient",
            clinicalAdvice: "Combination may be used with careful monitoring for adverse effects.",
            monitoring: "Check vital parameters and adjust dose if required."
        };

    }

    if (severity === "mild" || severity === "minor") {

        return {
            action: "Use with caution",
            clinicalAdvice: "Interaction risk is low but monitoring is recommended.",
            monitoring: "Observe patient for unexpected reactions."
        };

    }

    return {
        action: "Unknown",
        clinicalAdvice: "Insufficient information for recommendation.",
        monitoring: "Consult healthcare professional."
    };
}


/* --------------------------------------------------
   Generate Recommendations for Multiple Interactions
--------------------------------------------------*/

function generateRecommendations(interactions) {

    let recommendations = [];

    interactions.forEach(item => {

        const rec = generateRecommendation(item.severity);

        recommendations.push({
            herb: item.herb,
            drug: item.drug,
            severity: item.severity,
            action: rec.action,
            clinicalAdvice: rec.clinicalAdvice,
            monitoring: rec.monitoring
        });

    });

    return recommendations;
}


/* --------------------------------------------------
   Overall Safety Recommendation
--------------------------------------------------*/

function overallSafetyAdvice(interactions) {

    let severeCount = interactions.filter(i =>
        i.severity.toLowerCase() === "severe"
    ).length;

    let moderateCount = interactions.filter(i =>
        i.severity.toLowerCase() === "moderate"
    ).length;

    if (severeCount > 0) {

        return "High risk detected. Avoid certain herb–drug combinations and consult a physician immediately.";

    }

    if (moderateCount > 0) {

        return "Moderate interaction risk. Monitor patient and adjust therapy if necessary.";

    }

    return "Low interaction risk. Use with caution and monitor patient.";
}


/* --------------------------------------------------
   Export Functions
--------------------------------------------------*/

module.exports = {
    generateRecommendation,
    generateRecommendations,
    overallSafetyAdvice
};
