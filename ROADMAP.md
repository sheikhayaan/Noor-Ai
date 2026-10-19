# Noor AI Roadmap

## Phase 0: Foundation

Goal: Turn the Noor AI vision into a clear build plan.

Tasks:

- Define product modules.
- Choose the first tech stack.
- Create the project architecture.
- Decide which model provider to use first.
- Set up local development.
- Build the first working chat loop.

Output:

- Working local app skeleton.
- Basic chat page.
- Backend API endpoint for AI responses.

## Phase 1: Noor AI MVP

Goal: Build a useful first version of Noor AI.

Features:

- General AI chat
- Tutor mode for class 6 to PhD-level explanations
- Coding assistant mode
- Content creation mode
- Research assistant mode
- Conversation history
- Basic user preferences

Technical components:

- FastAPI backend
- Frontend app
- Prompt routing by mode
- Model provider abstraction
- SQLite database

## Phase 2: Memory and RAG

Goal: Make Noor AI remember and retrieve useful knowledge.

Features:

- User profile memory
- Project memory
- Uploaded document Q&A
- Notes and summaries
- Retrieval-Augmented Generation

Technical components:

- Embedding model
- Vector database
- Document parser
- Memory ranking
- Source-aware answers

## Phase 3: Agents and Tools

Goal: Let Noor AI perform multi-step work.

Features:

- Research agent
- Coding agent
- Content planning agent
- Study plan agent
- File and document tools
- Web research workflow

Technical components:

- Tool registry
- Agent planner
- Task execution loop
- Safety checks
- Logging and evaluation

## Phase 4: Custom ML and Fine-Tuning

Goal: Start building Noor-specific intelligence.

Possible models:

- Content scoring model
- Learning-level classifier
- Intent classifier
- Recommendation model
- Small fine-tuned language model
- Code explanation evaluator

Technical components:

- Dataset collection pipeline
- Labeling workflow
- Training scripts
- Evaluation benchmarks
- Model registry

## Phase 5: Multimodal Noor AI

Goal: Add support for images, audio, video, and richer content creation.

Features:

- Image understanding
- Image generation integration
- Text-to-speech
- Speech-to-text
- Video script generation
- Shorts/Reels content workflows

Technical components:

- Audio processing
- Image model provider
- Media storage
- Background job queue

## Phase 6: Personal Intelligence Operating System

Goal: Turn Noor AI into a complete personal AI workspace.

Features:

- Long-term memory
- Project dashboards
- Personal knowledge base
- Autonomous task execution
- Study and work planner
- Creator workflow engine
- Developer workspace assistant

Technical components:

- Multi-agent orchestration
- Secure permissions
- User data controls
- Scalable cloud backend
- Evaluation and monitoring

## Learning Path for Building Noor AI

Study in this order:

1. Python programming
2. APIs with FastAPI
3. Frontend basics with React or Next.js
4. Databases and SQL
5. Machine learning fundamentals
6. Deep learning with PyTorch
7. Transformers and LLMs
8. Prompt engineering
9. Embeddings and vector search
10. RAG systems
11. Agents and tool use
12. Fine-tuning and evaluation
13. Deployment and security

## First Build Decision

Recommended first implementation:

- Python FastAPI backend
- Simple web frontend
- Local SQLite database
- Model provider abstraction
- One general chat endpoint
- Four modes: Tutor, Coding, Content, Research

This gives Noor AI a working body before we train specialized intelligence.

