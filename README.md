# Event Hub 🎟️

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen?style=flat-square)](https://github.com/Thienisme/event-hub/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Vue 3](https://img.shields.io/badge/Vue-3-42b883?style=flat-square&logo=vuedotjs)](https://vuejs.org/)
[![Laravel](https://img.shields.io/badge/Laravel-10-FF2D20?style=flat-square&logo=laravel)](https://laravel.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue?style=flat-square)](https://github.com/Thienisme/event-hub/pulls)

**Event Hub** is an open-source, scalable full-stack platform for organizing events, managing tickets, and tracking attendee registrations. It provides a seamless experience for event organizers and attendees alike, combining a modern Vue 3 frontend with a robust Laravel RESTful API backend.

---

## ✨ Key Features

### 🔐 User Authentication
- Secure registration & login with JWT / Laravel Sanctum
- Role-based access control (Admin, Organizer, Attendee)
- Password reset & email verification

### 📅 Event Management
- Create, edit, and publish events with rich details
- Categories, tags, and search/filter capabilities
- Event capacity & scheduling management

### 🎫 Booking & Ticketing
- Ticket purchase flow with quantity selection
- QR code ticket generation
- Booking history & cancellation support
- Real-time availability tracking

### 🛠️ Admin Dashboard
- Comprehensive analytics & reporting
- User & event moderation tools
- Order & revenue management
- System settings & configuration

---

## 🏗️ System Architecture / Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Vue 3 (Composition API), Vite, Pinia, Vue Router, Element Plus / Tailwind CSS, Axios |
| **Backend** | PHP Laravel (RESTful API), JWT / Laravel Sanctum Authentication |
| **Database** | MySQL |
| **DevOps** | Docker, Docker Compose, Git |

---

## 📂 Project Directory Structure

```
event-hub/
├── client/                 # Vue 3 + Vite client application
│   ├── src/
│   │   ├── assets/           # Static assets
│   │   ├── components/       # Reusable Vue components
│   │   ├── views/            # Route views / pages
│   │   ├── stores/           # Pinia state management
│   │   ├── router/           # Vue Router configuration
│   │   ├── services/         # Axios API services
│   │   └── main.ts           # App entry point
│   ├── public/               # Public static files
│   ├── .env.example          # Environment variables template
│   ├── package.json
│   └── vite.config.ts
├── server/                  # Laravel RESTful API
│   ├── app/
│   │   ├── Http/Controllers/ # API controllers
│   │   ├── Models/           # Eloquent models
│   │   └── ...
│   ├── database/
│   │   ├── migrations/       # Database migrations
│   │   └── seeders/          # Database seeders
│   ├── routes/
│   │   └── api.php           # API route definitions
│   ├── .env.example          # Environment variables template
│   ├── composer.json
│   └── artisan
├── docker-compose.yml        # Docker Compose configuration
├── .gitignore
└── README.md
```

---

## 🚀 Getting Started / Local Setup

### Prerequisites
- Node.js >= 18.x & npm
- PHP >= 8.1 & Composer
- MySQL >= 8.0
- Git

### 1. Clone the repository

```bash
git clone https://github.com/Thienisme/event-hub.git
cd event-hub
```

### 2. Backend (Laravel) Setup

```bash
cd server
cp .env.example .env
composer install
php artisan key:generate
php artisan migrate --seed
php artisan serve
```

Update `.env` with your database credentials:

```env
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=event_hub
DB_USERNAME=root
DB_PASSWORD=secret
```

### 3. Frontend (Vue 3) Setup

```bash
cd ../client
cp .env.example .env
npm install
npm run dev
```

Configure the API base URL in `client/.env`:

```env
VITE_API_BASE_URL=http://localhost:8000/api
```

### 4. Access the Application
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000

---

## 🐳 Docker Setup

Run the entire stack with Docker Compose:

```bash
docker-compose up -d
```

This will start the frontend, backend, and MySQL services. Once running, execute migrations:

```bash
docker-compose exec backend php artisan migrate --seed
```

---

## 🤝 Contributing

Contributions are welcome! To contribute:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m "feat: add your feature"`
4. Push to the branch: `git push origin feature/your-feature`
5. Open a Pull Request

Please open an Issue first to discuss major changes. Follow the existing code style and include tests where applicable.

---

## 📄 License

This project is licensed under the [MIT License](https://opensource.org/licenses/MIT). See the `LICENSE` file for details.

---

> Built with ❤️ by [Thienisme](https://github.com/Thienisme) and the open-source community.
