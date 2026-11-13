-- ============================================================================
-- RescueBite: Surplus Food Rescue & Redistribution Platform
-- UN Sustainable Development Goals: SDG 2 (Zero Hunger) & SDG 12 (Responsible Consumption)
-- Database Schema (MySQL 8.0+ / PostgreSQL 15+ Compatible)
-- ============================================================================

CREATE DATABASE IF NOT EXISTS food_rescue_db;
USE food_rescue_db;

-- 1. Donors Table (Restaurants, Hostels, Event Halls, Campus Messes, Hotels)
CREATE TABLE IF NOT EXISTS donors (
    donor_id VARCHAR(32) PRIMARY KEY,
    organization_name VARCHAR(150) NOT NULL,
    donor_type VARCHAR(40) NOT NULL CHECK (donor_type IN ('RESTAURANT', 'HOSTEL', 'EVENT_HALL', 'CAMPUS_MESS', 'HOTEL')),
    contact_person VARCHAR(100),
    contact_phone VARCHAR(30) NOT NULL,
    address VARCHAR(255) NOT NULL,
    latitude DECIMAL(9, 6) NOT NULL,
    longitude DECIMAL(9, 6) NOT NULL,
    fssai_hygiene_verified BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. NGOs & Shelters Table
CREATE TABLE IF NOT EXISTS ngos (
    ngo_id VARCHAR(32) PRIMARY KEY,
    ngo_name VARCHAR(150) NOT NULL,
    registration_number VARCHAR(60) UNIQUE NOT NULL,
    primary_volunteer VARCHAR(100) NOT NULL,
    contact_phone VARCHAR(30) NOT NULL,
    base_address VARCHAR(255) NOT NULL,
    latitude DECIMAL(9, 6) NOT NULL,
    longitude DECIMAL(9, 6) NOT NULL,
    daily_beneficiary_capacity INT DEFAULT 200,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Surplus Food Batches Table (Synced with Java PriorityQueue<FoodBatch> Engine)
CREATE TABLE IF NOT EXISTS food_batches (
    batch_id VARCHAR(32) PRIMARY KEY,
    donor_name VARCHAR(150) NOT NULL,
    donor_type VARCHAR(40) NOT NULL,
    contact_phone VARCHAR(30) NOT NULL,
    food_title VARCHAR(220) NOT NULL,
    category VARCHAR(40) NOT NULL CHECK (category IN ('COOKED_MEALS', 'BAKERY', 'PRODUCE', 'DAIRY_PACKAGED', 'EVENT_BUFFET')),
    dietary_type VARCHAR(20) NOT NULL CHECK (dietary_type IN ('VEG', 'NON_VEG', 'VEGAN')),
    servings INT NOT NULL CHECK (servings > 0),
    weight_kg DECIMAL(7, 2) NOT NULL CHECK (weight_kg > 0),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expiry_time TIMESTAMP NOT NULL,
    pickup_address VARCHAR(255) NOT NULL,
    latitude DECIMAL(9, 6) NOT NULL,
    longitude DECIMAL(9, 6) NOT NULL,
    storage_notes TEXT,
    status VARCHAR(25) NOT NULL DEFAULT 'AVAILABLE'
        CHECK (status IN ('AVAILABLE', 'CLAIMED', 'EN_ROUTE', 'PICKED_UP', 'DELIVERED', 'EXPIRED')),
    claimed_by_ngo VARCHAR(150),
    volunteer_name VARCHAR(100),
    volunteer_phone VARCHAR(30),
    claimed_at TIMESTAMP NULL,
    picked_up_at TIMESTAMP NULL,
    delivered_at TIMESTAMP NULL
);

-- Index for fast expiry window scans and Java PriorityQueue warm-up queries
CREATE INDEX idx_food_batches_status_expiry ON food_batches (status, expiry_time ASC);

-- 4. Pickup Status Audit Log Table
CREATE TABLE IF NOT EXISTS pickup_tracking_logs (
    log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    batch_id VARCHAR(32) NOT NULL,
    previous_status VARCHAR(25),
    new_status VARCHAR(25) NOT NULL,
    actor_name VARCHAR(120),
    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES food_batches(batch_id) ON DELETE CASCADE
);

-- 5. Real-Time Alerts Table
CREATE TABLE IF NOT EXISTS realtime_alerts (
    alert_id VARCHAR(32) PRIMARY KEY,
    batch_id VARCHAR(32) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('CRITICAL', 'URGENT', 'INFO', 'SUCCESS')),
    title VARCHAR(180) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- Haversine Distance SQL Query Reference (Finds nearest NGOs within 10 km)
-- ============================================================================
-- SELECT
--     batch_id, food_title, donor_name, servings, expiry_time,
--     (6371 * ACOS(
--         COS(RADIANS(12.9615)) * COS(RADIANS(latitude)) *
--         COS(RADIANS(longitude) - RADIANS(77.6100)) +
--         SIN(RADIANS(12.9615)) * SIN(RADIANS(latitude))
--     )) AS distance_km
-- FROM food_batches
-- WHERE status = 'AVAILABLE' AND expiry_time > CURRENT_TIMESTAMP
-- ORDER BY expiry_time ASC, distance_km ASC;
