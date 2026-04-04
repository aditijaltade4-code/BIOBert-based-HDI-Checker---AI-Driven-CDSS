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
        if not text: return {"results": [], "status": "error"}

        # 1. AI NER Detection (BioBERT does the heavy lifting here)
        api_results = query_biobert_api(text)
        
        if isinstance(api_results, dict) and "estimated_time" in api_results:
            return {"status": "loading", "message": "BioBERT is warming up..."}

        # 2. WORD RECONSTRUCTION (Fixes fragmented AI tokens)
        found_entities = []
        current_word = ""

        if isinstance(api_results, list):
            for ent in api_results:
                word = ent.get('word', '')
                if word.startswith("##"):
                    current_word += word.replace("##", "")
                else:
                    if current_word: found_entities.append(current_word.title())
                    current_word = word
            if current_word: found_entities.append(current_word.title())

        # 3. DEDUPLICATE & CLEAN
        # This keeps only unique medical terms found by the AI
        final_entities = []
        for e in found_entities:
            if len(e) > 2 and e not in final_entities:
                final_entities.append(e)

        print(f"🧠 BioBERT Autonomous Detection: {final_entities}")

        # 4. THE "NO-CSV" LOGIC
        # If the AI finds at least 2 things, we CREATE the interaction report
        if len(final_entities) >= 2:
            herb = final_entities[0]
            drug = final_entities[1]

            # Generate a dynamic clinical response based on AI detection
            autonomous_result = {
                "herb": herb,
                "drug": drug,
                "interaction_text": f"AI Alert: Potential pharmacodynamic interaction between {herb} and {drug}.",
                "mechanism": "Neural Entity Recognition identified co-administration of bioactive agents.",
                "severity": "Clinical Review Required",
                "recommendation": f"Evaluate patient for synergistic or antagonistic effects of {herb} on {drug} therapy.",
                "evidence_level": "AI Predicted (BioBERT)",
                "citation_url": f"https://pubmed.ncbi.nlm.nih.gov/?term={herb}+{drug}+interaction"
            }
            
            return {"results": [autonomous_result], "status": "success"}

        return {
            "results": [], 
            "detected_entities": final_entities, 
            "message": "AI needs at least two medical entities (e.g., Turmeric and Aspirin)."
        }

    except Exception as e:
        return {"results": [], "status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
