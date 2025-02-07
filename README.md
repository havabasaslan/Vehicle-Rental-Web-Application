# HAVA BASASLAN / 38248

# Vehicle Rental Web Application


## Application Functionalities:

- CRUD Operations: Performing create, read, update, and delete operations on the database.

- User Login and Registration: Secure authentication processes enabling users to register and log in to the system.

- Admin Panel Operations: Providing a comprehensive admin panel for admin users to manage system-related operations.

- Role and Permission Management: Dynamic management and enforcement of roles and permissions for different types of users (admin, standard user, etc.).

- Unauthorized Access Control: Preventing access to certain pages or data for users who are not authorized or do not have the necessary permissions.

- Car Filtering: Allowing users to filter vehicles based solely on their brand.

- Pagination Structure: Implementing pagination for large datasets, ensuring that users can efficiently navigate and access the data.

- Add Car to Favorites: Enabling users to add cars to their favorites list and easily track their preferred vehicles.

- Car Rental by Date Range: Allowing users to rent cars based on selected date ranges, managing the rental duration efficiently.

- Fake Payment Process: Implementing a mock payment system for testing purposes, simulating the payment process without real transactions.

- Management of Paid Rentals: Managing and tracking car rentals where the payment has been successfully processed.

- Prevention of Rentals for Unlogged Users: Ensuring that users who have not logged in are prevented from renting vehicles, redirecting them to the login page.

## Requirements

- Docker
- Docker Compose

## Install

1. Clone the project:
```bash
git clone <repo-url>
cd <project-folder>
```

2. Start the Docker containers:
```bash
docker-compose up --build
```

3. Open the following address in your browser:
```
http://localhost:3000
```

4. Log in to the application with the following admin credentials.:
```
username: admin
password: admin123
```

## Technologies

- Node.js
- Express.js
- EJS Template Engine
- PostgreSQL
- Docker
- Bootstrap 5
- Font Awesome

## Use Adminer

1. Open the following address in your browser:
```
http://localhost:8080
```

2. Access with the following information. :

- **System**: PostgreSQL
- **Server**: postgres-db
- **Username**: postgres
- **Password**: 123456
- **Database**: vehicle_db



