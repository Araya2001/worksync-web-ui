# WorkSync Web UI

This is a React application built with Vite.

## Development Setup

**IMPORTANT**: Only the user should run npm commands. Claude should not execute any npm run tasks.

- The user needs to run `npm install` to install dependencies
- The user needs to run `npm run dev` to start the development server
- The user manages all npm tasks including build, test, lint, etc.

## Project Structure

This appears to be a React/Vite-based web application for WorkSync.

## CORS Configuration

### Frontend (Vite Dev Server)
The Vite configuration has been updated to allow CORS from:
- http://localhost:5173
- https://stratos.a.pinggy.link
- http://stratos.a.pinggy.link

### Backend CORS Requirements
The Spring Boot backend at `https://worksync-integration-handler-625943711296.europe-west1.run.app` needs to be configured to allow CORS from:
- https://stratos.a.pinggy.link
- http://stratos.a.pinggy.link

**Backend Configuration Needed:**
```java
@CrossOrigin(origins = {
    "http://localhost:5173",
    "https://stratos.a.pinggy.link", 
    "http://stratos.a.pinggy.link"
})
```

Or in application.properties/application.yml:
```yaml
cors:
  allowed-origins:
    - http://localhost:5173
    - https://stratos.a.pinggy.link
    - http://stratos.a.pinggy.link
```