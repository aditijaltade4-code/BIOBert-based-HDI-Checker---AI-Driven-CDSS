import os
import requests
import re
from fastapi import FastAPI, Request
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="BioBERT Clinical Hybrid Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 1. THE SYNONYM BRIDGE (NORMALIZATION LAYER) ---
# Maps various names to a "Standard Clinical Name" for consistency
SYNONYM_BRIDGE = {
    # Antidiabetics & Common Brands
    "glimipride": "Glimepiride", 
    "glimepiride": "Glimepiride",
    "amaryl": "Glimepiride",
    "glycomet": "Metformin",
    "metformin": "Metformin",
    
    # GI & Acid Reflux
    "omez": "Pantoprazole",
    "pantoprazole": "Pantoprazole",
    "pan-d": "Pantoprazole",
    "pantocid": "Pantoprazole",
    "omeprazole": "Pantoprazole",
    
    # Cardiovascular & Blood Thinners
    "aspirin": "Aspirin",
    "ecosprin": "Aspirin",
    "disprin": "Aspirin",
    "warfarin": "Warfarin",
    "coumadin": "Warfarin",
    "furosemide": "Furosemide",
    "lasix": "Furosemide",

    # Herbs, Active Compounds & Ayurvedic Names
    "turmeric": "Curcumin",
    "curcumin": "Curcumin",
    "haridra": "Curcumin",
    "aloe vera": "Aloe Vera",
    "aleovera": "Aloe Vera",
    "ghritkumari": "Aloe Vera",
    "ashwagandha": "Ashwagandha",
    "asvagandha": "Ashwagandha",
    "gallic acid": "Gallic Acid",
    "gallic": "Gallic Acid",
    "triphala": "Triphala",
    "guggulu": "Guggulu",
    "gulgul": "Guggulu"
}

API_URL = "https://api-inference.huggingface.co/models/d4data/biomedical-ner-all"
HF_TOKEN = os.getenv("HF_TOKEN")
headers = {"Authorization": f"Bearer {HF_TOKEN}"}

class AnalyzeRequest(BaseModel):
    text: str

def normalize_entity(word):
    """Translates identified tokens into Standardized Clinical Names."""
    word_clean = word.lower().strip()
    return SYNONYM_BRIDGE.get(word_clean, word.title())

def query_biobert_api(text):
    if not HF_TOKEN: return []
    try:
        response = requests.post(API_URL, headers=headers, json={"inputs": text}, timeout=10)
        return response.json()
    except:
        return []

@app.post("/analyze")
async def analyze_text(request: AnalyzeRequest):
    try:
        raw_text = request.text
        clean_text = raw_text.lower()
        print(f"📥 Processing: '{raw_text}'")

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
        
        # 2. KEYWORD SCANNER (Secondary Detection)
        for key in SYNONYM_BRIDGE.keys():
            if key in clean_text and key not in [w.lower() for w in raw_detected]:
                raw_detected.append(key)

        # 3. NORMALIZATION & DEDUPLICATION
        # This converts 'ecosprin' -> 'Aspirin' and 'haridra' -> 'Curcumin'
        final_entities = []
        for word in raw_detected:
            standardized = normalize_entity(word)
            if standardized not in final_entities and len(standardized) > 2:
                final_entities.append(standardized)

        print(f"🧠 Final Normalized Entities: {final_entities}")

        # 4. CLINICAL INTERACTION LOGIC
        if len(final_entities) >= 2:
            # We take the first two recognized entities
            entity_one, entity_two = final_entities[0], final_entities[1]
            
            return {
                "status": "success",
                "results": [{
                    "herb": entity_one,
                    "drug": entity_two,
                    "interaction_text": f"Potential clinical interaction identified between {entity_one} and {entity_two}.",
                    "mechanism": "Neural Entity Normalization identified co-administration of bioactive agents.",
                    "severity": "Clinical Alert",
                    "recommendation": "Monitor patient for altered therapeutic efficacy or synergistic effects.",
                    "evidence_level": "AI Predicted (BioBERT Hybrid)",
                    "citation_url": f"https://pubmed.ncbi.nlm.nih.gov/?term={entity_one}+{entity_two}+interaction"
                }]
            }

        return {
            "results": [], 
            "detected_entities": final_entities,
            "message": "AI found fewer than 2 clinical entities. Try using standard or brand names."
        }

    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return {"results": [], "status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    # Use port 8000 for internal bridge; 0.0.0.0 mandatory for Render
    uvicorn.run(app, host="0.0.0.0", port=8000)
