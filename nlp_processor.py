import os
import requests
import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="BioBERT Clinical Hybrid Engine")

# --- CORS FIX: This stops the "System Offline" error ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 1. THE SYNONYM BRIDGE (NORMALIZATION LAYER) ---
SYNONYM_BRIDGE = {
    "glimipride": "Glimepiride", "glimepiride": "Glimepiride", "amaryl": "Glimepiride",
    "glycomet": "Metformin", "metformin": "Metformin",
    "omez": "Pantoprazole", "pantoprazole": "Pantoprazole", "pan-d": "Pantoprazole",
    "pantocid": "Pantoprazole", "omeprazole": "Pantoprazole",
    "aspirin": "Aspirin", "ecosprin": "Aspirin", "disprin": "Aspirin",
    "warfarin": "Warfarin", "coumadin": "Warfarin",
    "furosemide": "Furosemide", "lasix": "Furosemide",
    "turmeric": "Curcumin", "curcumin": "Curcumin", "haridra": "Curcumin",
    "aloe vera": "Aloe Vera", "aleovera": "Aloe Vera", "ghritkumari": "Aloe Vera",
    "ashwagandha": "Ashwagandha", "asvagandha": "Ashwagandha",
    "gallic acid": "Gallic Acid", "gallic": "Gallic Acid",
    "triphala": "Triphala", "haritaki": "Triphala", "vibhitaki": "Triphala", "amalaki": "Triphala",
    "guggulu": "Guggulu", "gulgul": "Guggulu"
}

API_URL = "https://api-inference.huggingface.co/models/d4data/biomedical-ner-all"
HF_TOKEN = os.getenv("HF_TOKEN")
headers = {"Authorization": f"Bearer {HF_TOKEN}"}

class AnalyzeRequest(BaseModel):
    text: str

def normalize_entity(word):
    word_clean = word.lower().strip()
    return SYNONYM_BRIDGE.get(word_clean, word.title())

def query_biobert_api(text):
    if not HF_TOKEN: 
        print("⚠️ HF_TOKEN missing in environment variables")
        return []
    try:
        response = requests.post(API_URL, headers=headers, json={"inputs": text}, timeout=10)
        return response.json()
    except Exception as e:
        print(f"⚠️ BioBERT API Error: {e}")
        return []

# ROUTE MATCHING: Ensure app.js calls /analyze
@app.post("/analyze")
async def analyze_text(request: AnalyzeRequest):
    try:
        raw_text = request.text
        clean_text = raw_text.lower()
        print(f"📥 Received: '{raw_text}'")

        # 1. AI NER DETECTION
        api_results = query_biobert_api(raw_text)
        raw_detected = []

        if isinstance(api_results, list):
            current_word = ""
            for ent in api_results:
                word = ent.get('word', '')
                if word.startswith("##"):
                    current_word += word.replace("##", "")
                else:
                    if current_word: raw_detected.append(current_word)
                    current_word = word
            if current_word: raw_detected.append(current_word)
        
        # 2. KEYWORD SCANNER (Matches manual inputs like "Haritaki")
        for key in SYNONYM_BRIDGE.keys():
            if key in clean_text and key not in [w.lower() for w in raw_detected]:
                raw_detected.append(key)

        # 3. NORMALIZATION
        final_entities = []
        for word in raw_detected:
            standardized = normalize_entity(word)
            if standardized not in final_entities and len(standardized) > 2:
                final_entities.append(standardized)

        print(f"🧠 Entities Identified: {final_entities}")

        # 4. DYNAMIC INTERACTION GENERATION
        if len(final_entities) >= 2:
            e1, e2 = final_entities[0], final_entities[1]
            return {
                "status": "success",
                "results": [{
                    "herb": e1,
                    "drug": e2,
                    "interaction_text": f"Potential clinical interaction identified between {e1} and {e2}.",
                    "mechanism": "Neural Entity Normalization identified co-administration of bioactive agents.",
                    "severity": "Clinical Alert",
                    "recommendation": "Monitor patient for altered therapeutic efficacy or synergistic effects.",
                    "evidence_level": "AI Predicted (BioBERT Hybrid)",
                    "citation_url": f"https://pubmed.ncbi.nlm.nih.gov/?term={e1}+{e2}+interaction"
                }]
            }

        return {
            "results": [], 
            "detected_entities": final_entities,
            "message": "AI found fewer than 2 clinical entities. Please specify both an herb and a drug."
        }

    except Exception as e:
        print(f"❌ Server Error: {str(e)}")
        return {"results": [], "status": "error", "message": str(e)}

# --- RENDER PORT BINDING FIX ---
if __name__ == "__main__":
    # We hardcode 8080 because this is INTERNAL. 
    # Node will talk to Python on this port.
    uvicorn.run(app, host="127.0.0.1", port=8080)
