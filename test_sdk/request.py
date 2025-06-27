import os
import requests
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("API_KEY")
PROJECT_ID = os.getenv("PROJECT_ID")
MODEL_ID = os.getenv("MODEL_ID")

# 1. Get IAM token
def get_token(api_key):
    url = "https://iam.cloud.ibm.com/identity/token"
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    data = {
        "grant_type": "urn:ibm:params:oauth:grant-type:apikey",
        "apikey": api_key
    }
    resp = requests.post(url, headers=headers, data=data)
    resp.raise_for_status()
    return resp.json()["access_token"]

# 2. Ask a question
def ask_question(token, project_id, model_id, question):
    url = "https://us-south.ml.cloud.ibm.com/ml/v1/text/chat?version=2023-05-29"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    body = {
        "messages": [
            {"role": "system", "content": "You are a helpful AI assistant."},
            {"role": "user", "content": question}
        ],
        "project_id": project_id,
        "model_id": model_id,
        "max_tokens": 100
    }

    response = requests.post(url, headers=headers, json=body)
    response.raise_for_status()
    result = response.json()
    if "choices" in result:
        # choices, 0, message, content
        return result["choices"][0]["message"]["content"]
    else:
        print("⚠️ Response missing 'results':")
        print(result)
        return "No answer."

# 3. Run
if __name__ == "__main__":
    try:
        print("Getting token...")
        token = get_token(API_KEY)

        print("Asking question...")
        answer = ask_question(token, PROJECT_ID, MODEL_ID, "How many days are in a leap year?")
        print("Answer:", answer)

        with open("chat_response.txt", "w") as f:
            f.write(answer)

    except Exception as e:
        print("Error:", e)
