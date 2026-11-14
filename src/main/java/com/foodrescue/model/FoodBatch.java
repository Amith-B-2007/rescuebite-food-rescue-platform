package com.foodrescue.model;

import java.time.Duration;
import java.time.Instant;

/**
 * Represents a surplus food batch posted by a donor (Restaurant, Hostel, or Event Hall).
 * Implements Comparable<FoodBatch> for direct use in java.util.PriorityQueue<FoodBatch>
 * so that batches closest to expiry (most urgent) are prioritized at the head of the queue.
 */
public class FoodBatch implements Comparable<FoodBatch> {

    private String id;
    private String donorName;
    private String donorType;       // RESTAURANT, HOSTEL, EVENT_HALL, CAMPUS_MESS, HOTEL
    private String contactPhone;
    private String foodTitle;
    private String category;        // COOKED_MEALS, BAKERY, PRODUCE, DAIRY_PACKAGED, EVENT_BUFFET
    private String dietaryType;     // VEG, NON_VEG, VEGAN
    private int servings;
    private double weightKg;
    private Instant createdAt;
    private Instant expiryTime;
    private String pickupAddress;
    private double latitude;
    private double longitude;
    private String storageNotes;

    // Status workflow: AVAILABLE -> CLAIMED -> EN_ROUTE -> PICKED_UP -> DELIVERED (or EXPIRED)
    private String status;
    private boolean hygieneVerified;
    private String pickupOtp;
    private String claimedByNgo;
    private String volunteerName;
    private String volunteerPhone;
    private Instant claimedAt;
    private Instant pickedUpAt;
    private Instant deliveredAt;

    public FoodBatch(
            String id,
            String donorName,
            String donorType,
            String contactPhone,
            String foodTitle,
            String category,
            String dietaryType,
            int servings,
            double weightKg,
            Instant createdAt,
            Instant expiryTime,
            String pickupAddress,
            double latitude,
            double longitude,
            String storageNotes
    ) {
        this.id = id;
        this.donorName = donorName;
        this.donorType = donorType;
        this.contactPhone = contactPhone;
        this.foodTitle = foodTitle;
        this.category = category;
        this.dietaryType = dietaryType;
        this.servings = servings;
        this.weightKg = weightKg;
        this.createdAt = createdAt;
        this.expiryTime = expiryTime;
        this.pickupAddress = pickupAddress;
        this.latitude = latitude;
        this.longitude = longitude;
        this.storageNotes = storageNotes;
        this.status = "AVAILABLE";
        this.hygieneVerified = true;
        this.pickupOtp = String.valueOf(1000 + Math.abs(id.hashCode() % 9000));
    }

    /**
     * Remaining minutes until expiry from current time.
     */
    public long getMinutesUntilExpiry() {
        return Duration.between(Instant.now(), expiryTime).toMinutes();
    }

    /**
     * Remaining seconds until expiry from current time.
     */
    public long getSecondsUntilExpiry() {
        return Duration.between(Instant.now(), expiryTime).getSeconds();
    }

    /**
     * Computes a composite urgency priority key (lower value = higher priority in Min-Heap).
     * Primarily driven by remaining minutes until expiry, adjusted slightly by perishability
     * and meal volume so larger highly perishable batches break ties first.
     */
    public double getPriorityHeapKey() {
        long secondsLeft = getSecondsUntilExpiry();
        double minutesLeft = secondsLeft / 60.0;
        double perishabilityMultiplier = switch (category != null ? category : "") {
            case "COOKED_MEALS", "EVENT_BUFFET" -> 0.90;
            case "DAIRY_PACKAGED" -> 0.95;
            case "BAKERY" -> 1.00;
            default -> 1.05;
        };
        double volumeBonus = Math.min(10.0, servings / 25.0);
        return (minutesLeft * perishabilityMultiplier) - volumeBonus;
    }

    /**
     * Urgency tier classification based on remaining window.
     */
    public String getUrgencyLevel() {
        if ("DELIVERED".equals(status)) {
            return "COMPLETED";
        }
        long mins = getMinutesUntilExpiry();
        if (mins <= 0 || "EXPIRED".equals(status)) {
            return "EXPIRED";
        } else if (mins <= 60) {
            return "CRITICAL";
        } else if (mins <= 150) {
            return "HIGH";
        } else if (mins <= 270) {
            return "MEDIUM";
        } else {
            return "SAFE";
        }
    }

    /**
     * PriorityQueue natural ordering:
     * 1. Active ("AVAILABLE") non-expired batches come before already-claimed/completed ones.
     * 2. Earlier expiry time / lower priorityHeapKey is placed at the head of the queue (Min-Heap).
     */
    @Override
    public int compareTo(FoodBatch other) {
        boolean thisActive = "AVAILABLE".equals(this.status) && this.getSecondsUntilExpiry() > 0;
        boolean otherActive = "AVAILABLE".equals(other.status) && other.getSecondsUntilExpiry() > 0;

        if (thisActive != otherActive) {
            return thisActive ? -1 : 1;
        }
        int cmp = Double.compare(this.getPriorityHeapKey(), other.getPriorityHeapKey());
        if (cmp != 0) {
            return cmp;
        }
        return this.expiryTime.compareTo(other.expiryTime);
    }

    // Getters & Setters
    public String getId() { return id; }
    public String getDonorName() { return donorName; }
    public String getDonorType() { return donorType; }
    public String getContactPhone() { return contactPhone; }
    public String getFoodTitle() { return foodTitle; }
    public String getCategory() { return category; }
    public String getDietaryType() { return dietaryType; }
    public int getServings() { return servings; }
    public double getWeightKg() { return weightKg; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getExpiryTime() { return expiryTime; }
    public String getPickupAddress() { return pickupAddress; }
    public double getLatitude() { return latitude; }
    public double getLongitude() { return longitude; }
    public String getStorageNotes() { return storageNotes; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getClaimedByNgo() { return claimedByNgo; }
    public void setClaimedByNgo(String claimedByNgo) { this.claimedByNgo = claimedByNgo; }
    public String getVolunteerName() { return volunteerName; }
    public void setVolunteerName(String volunteerName) { this.volunteerName = volunteerName; }
    public String getVolunteerPhone() { return volunteerPhone; }
    public void setVolunteerPhone(String volunteerPhone) { this.volunteerPhone = volunteerPhone; }
    public Instant getClaimedAt() { return claimedAt; }
    public void setClaimedAt(Instant claimedAt) { this.claimedAt = claimedAt; }
    public Instant getPickedUpAt() { return pickedUpAt; }
    public void setPickedUpAt(Instant pickedUpAt) { this.pickedUpAt = pickedUpAt; }
    public Instant getDeliveredAt() { return deliveredAt; }
    public void setDeliveredAt(Instant deliveredAt) { this.deliveredAt = deliveredAt; }
    public boolean isHygieneVerified() { return hygieneVerified; }
    public void setHygieneVerified(boolean hygieneVerified) { this.hygieneVerified = hygieneVerified; }
    public String getPickupOtp() { return pickupOtp; }
    public void setPickupOtp(String pickupOtp) { this.pickupOtp = pickupOtp; }
    public void setExpiryTime(Instant expiryTime) { this.expiryTime = expiryTime; }
}
