# GTWY.AI Middleware (Node.js Backend)

**CRUD Operations & Management Layer for GTWY.AI Platform**

This is the Node.js/Express backend that provides the management and configuration layer for the GTWY.AI platform. It handles all CRUD operations for agents, chatbots, RAG collections, API keys, and other platform resources that power the main AI orchestration system.

## 🎯 Purpose

This project serves as the **configuration and management backend** for GTWY.AI. While the main Python FastAPI service handles AI orchestration and real-time inference, this Node.js middleware manages:

- Agent configuration and versioning
- Chatbot setup and customization
- RAG collection management
- API key storage and management
- User authentication and organization management
- Usage metrics and reporting
- Template and prompt libraries

**Key Components:**

- **Express.js Server**: RESTful API with async error handling
- **MongoDB**: Primary data store for configurations, chatbots, RAG collections
- **PostgreSQL**: Relational history (conversation logs, orchestrator history)
- **TimescaleDB**: Time-series metrics for analytics
- **Redis**: Caching, rate limiting, and session management
- **RabbitMQ**: Asynchronous job processing

For detailed architecture documentation, see [`docs/architecture.md`](docs/architecture.md).

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v16 or higher)
- **npm** or **yarn**
- **MongoDB** (v4.4 or higher)
- **PostgreSQL** (v12 or higher)
- **TimescaleDB** extension for PostgreSQL
- **Redis** (v6 or higher)
- **RabbitMQ** (optional, for queue processing)

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/Walkover-Web-Solution/AI-middleware.git
cd AI-middleware
```

### 2. Install Dependencies

```bash
npm install
# or
yarn install
```

### 3. Environment Configuration

Copy the example environment file and configure your settings:

```bash
cp .env.example .env
```

Edit the `.env` file with your specific configuration values for MongoDB, PostgreSQL, Redis, JWT secrets, and other services. See `.env.example` for all available configuration options.

# Run migrations (if available)

npm run migrate

# or manually import schema files from models/postgres/ and models/timescale/

````

#### Redis

```bash
# Start Redis service
sudo systemctl start redis  # Linux
brew services start redis  # macOS
````

### 5. Run the Application

#### Development Mode

```bash
npm run dev
# or
yarn dev
```

#### Production Mode

```bash
npm start
# or
yarn start
```

The server will start on `http://localhost:3000` (or the port specified in your `.env` file).

### 6. Verify Installation

Check the health endpoint:

```bash
curl http://localhost:3000/healthcheck
```

## 📁 Project Structure

For detailed project structure and architecture, see [`docs/architecture.md`](docs/architecture.md).

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 📧 Support

For issues, questions, or contributions:

- Open an issue on GitHub
- Check the [architecture documentation](docs/architecture.md)
- Review the main project: [gtwy-ai](https://github.com/Walkover-Web-Solution/gtwy-ai)

---

Built with ❤️ by the Walkover team
