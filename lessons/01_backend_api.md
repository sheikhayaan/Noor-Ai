# Lesson 01: Noor AI Gets Its First API

## What You Built

Today we created the first backend for Noor AI.

A backend is the part of an application that runs behind the scenes. It receives requests, processes logic, talks to databases or AI models, and sends responses back to the frontend.

For Noor AI, the backend will later control:

- Chat messages
- AI model calls
- Tutor mode
- Coding assistant mode
- Content creation mode
- Research mode
- Memory
- RAG
- Agents

## What Is an API?

API means Application Programming Interface.

Simple meaning: an API is a doorway where one program can talk to another program.

Example:

- User opens Noor AI frontend.
- User types: "Explain gravity."
- Frontend sends this message to backend API.
- Backend sends the message to an AI model.
- Backend returns the AI answer.
- Frontend shows the answer.

## Files Created

- `backend/app/main.py`
- `backend/app/__init__.py`
- `backend/requirements.txt`

## Code Explanation

```python
from fastapi import FastAPI
```

This imports FastAPI, the framework we use to build APIs.

```python
app = FastAPI(...)
```

This creates the Noor AI backend app.

```python
@app.get("/")
def read_root():
```

This creates a route. A route is one API address.

When someone opens `/`, Noor AI returns a simple JSON response.

```python
@app.get("/health")
def health_check():
```

This creates a health check route. In real companies, health checks are used to confirm that a backend service is running properly.

## Commands to Run

From the project root:

```powershell
cd "C:\Users\sheik\Documents\noor ai"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
uvicorn backend.app.main:app --reload
```

Or after setup, use the helper script:

```powershell
.\scripts\start_backend.ps1
```

Then open:

```text
http://127.0.0.1:8000
```

You should see:

```json
{
  "app": "Noor AI",
  "message": "Noor AI backend is alive.",
  "status": "ok"
}
```

## Your Tiny Practice Task

Add one more route:

```text
/about
```

It should return:

```json
{
  "name": "Noor AI",
  "meaning": "Light",
  "mission": "Make advanced AI accessible to everyone."
}
```
