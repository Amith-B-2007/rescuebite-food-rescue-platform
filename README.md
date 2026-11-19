# RescueBite — Surplus Food Rescue & Redistribution Platform

### UN Sustainable Development Goals
* **SDG 2:** Zero Hunger
* **SDG 12:** Responsible Consumption & Production

---

## 1. Real-World Problem & Solution
Restaurants, university hostels, and wedding/event halls discard tons of fresh, edible food daily due to short shelf-life windows, while nearby shelters and NGOs face acute meal shortages.

**RescueBite** bridges this gap in real time:
1. **Donors (Restaurants / Hostels / Event Halls)** post surplus food listings with quantity (servings & weight in kg), expiry time window, hygiene storage notes, and GPS pickup coordinates.
2. **Java `PriorityQueue<FoodBatch>` Expiry Engine** automatically orders all active batches inside a binary Min-Heap so the most urgent, highly perishable meals are surfaced at the top (`queue.peek()` / `queue.poll()`).
3. **Haversine Geo-Distance & Feasibility Calculator** computes exact great-circle distance (`km`) and urban travel ETA (`mins`) from the selected NGO Hub to verify whether a volunteer can arrive before the food expires.
4. **NGOs & Volunteers** receive real-time alerts, claim batches in one click, and track chain-of-custody pickup status (`AVAILABLE` &rarr; `CLAIMED` &rarr; `EN_ROUTE` &rarr; `PICKED_UP` &rarr; `DELIVERED`).

---

## 2. Project Structure
```text
java project/
├── pom.xml                                        # Maven Project Configuration (Java 21)
├── start-server.bat                               # One-click Windows launcher
├── sql/
│   └── schema.sql                                 # MySQL / PostgreSQL Database Schema & Haversine SQL
└── src/
    └── main/
        ├── java/com/foodrescue/
        │   ├── FoodRescueServer.java              # Java HTTP & REST API Server (Port 8080)
        │   ├── model/
        │   │   ├── FoodBatch.java                 # Implements Comparable<FoodBatch> for PriorityQueue
        │   │   └── AlertEvent.java                # Real-time NGO alert event model
        │   ├── service/
        │   │   └── ExpiryPriorityQueueService.java# Core java.util.PriorityQueue<FoodBatch> manager
        │   └── util/
        │       └── DistanceCalculator.java        # Haversine formula distance & ETA feasibility
        └── resources/static/
            ├── index.html                         # Web Application UI
            ├── css/styles.css                     # Responsive dark-mode dashboard styling
            └── js/app.js                          # Live map, countdowns, PriorityQueue visualizer
```

---

## 3. How to Run
Double-click **`start-server.bat`** (or run it from the terminal), then open:
- **http://localhost:8080**
