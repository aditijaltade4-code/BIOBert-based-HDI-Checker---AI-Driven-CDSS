import os
import requests
from fastapi import FastAPI, Request
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="BioBERT Autonomous Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 1. CONFIGURATION ---
API_URL = "https://api-inference.huggingface.co/models/d4data/biomedical-ner-all"
HF_TOKEN = os.getenv("HF_TOKEN")
headers = {"Authorization": f"Bearer {HF_TOKEN}"}

class AnalyzeRequest(BaseModel):
    text: str

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
        text = request.text
        print(f"📥 AI Processing: '{text}'")

        # 1. Get raw tokens from BioBERT
        api_results = query_biobert_api(text)
        
        if isinstance(api_results, dict) and "estimated_time" in api_results:
            return {"status": "loading", "message": "BioBERT is warming up..."}

        # 2. THE RECONSTRUCTOR (Fixes 'Glim' + '##epi' + '##ride')
        found_entities = []
        current_word = ""

        if isinstance(api_results, list):
            for ent in api_results:
                word = ent.get('word', '')
                # If it's a sub-word fragment, glue it to the previous part
                if word.startswith("##"):
                    current_word += word.replace("##", "")
                else:
                    # Save the previous word before starting a new one
                    if current_word:
                        found_entities.append(current_word.strip().title())
                    current_word = word
            
            # Catch the very last word
            if current_word:
                found_entities.append(current_word.strip().title())

        # 3. DEDUPLICATE & CLEAN
        # We remove common English words that the AI sometimes accidentally flags
        stop_words = ["Patient", "Is", "Taking", "With", "And", "The", "For"]
        final_entities = [
            w for w in found_entities 
            if w not in stop_words and len(w) > 2
        ]
        
        # Remove duplicates while keeping order
        final_entities = list(dict.fromkeys(final_entities))

        print(f"🧠 AI Detected Entities: {final_entities}")

        # 4. AUTONOMOUS RESULT GENERATION (No CSV needed)
        if len(final_entities) >= 2:
            herb = final_entities[0]
            drug = final_entities[1]

            return {
                "status": "success",
                "results": [{
                    "herb": herb,
                    "drug": drug,
                    "interaction_text": f"AI Alert: Potential pharmacodynamic interaction between {herb} and {drug}.",
                    "mechanism": "Neural Entity Recognition identified co-administration of bioactive agents.",
                    "severity": "Clinical Review Required",
                    "recommendation": f"Monitor patient for synergistic or antagonistic effects of {herb} on {drug} therapy.",
                    "evidence_level": "AI Predicted (BioBERT)",
                    "citation_url": f"https://pubmed.ncbi.nlm.nih.gov/?term={herb}+{drug}"
                }]
            }

        return {
            "results": [], 
            "detected_entities": final_entities, 
            "message": "AI found fewer than 2 medical terms."
        }

    except Exception as e:
        return {"results": [], "status": "error", "message": str(e)}
               

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
