package com.foodrescue.util;

/**
 * Utility class for geographical distance and pickup feasibility calculations
 * using the Haversine formula.
 */
public class DistanceCalculator {

    private static final double EARTH_RADIUS_KM = 6371.0;
    private static final double AVERAGE_CITY_SPEED_KMH = 28.0; // Realistic urban speed
    private static final int PICKUP_BUFFER_MINUTES = 10;       // Loading/handover buffer

    /**
     * Calculates great-circle distance between two coordinates in kilometers
     * using the Haversine formula.
     *
     * @param lat1 Latitude of point A (Donor)
     * @param lon1 Longitude of point A (Donor)
     * @param lat2 Latitude of point B (NGO / Volunteer)
     * @param lon2 Longitude of point B (NGO / Volunteer)
     * @return Distance in kilometers rounded to 2 decimal places
     */
    public static double calculateHaversineDistanceKm(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);

        double radLat1 = Math.toRadians(lat1);
        double radLat2 = Math.toRadians(lat2);

        double a = Math.pow(Math.sin(dLat / 2), 2)
                + Math.cos(radLat1) * Math.cos(radLat2) * Math.pow(Math.sin(dLon / 2), 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        double rawDistance = EARTH_RADIUS_KM * c;
        return Math.round(rawDistance * 100.0) / 100.0;
    }

    /**
     * Estimates travel time in minutes for a given distance in kilometers.
     */
    public static int estimateTravelTimeMinutes(double distanceKm) {
        int driveMinutes = (int) Math.ceil((distanceKm / AVERAGE_CITY_SPEED_KMH) * 60.0);
        return Math.max(5, driveMinutes + PICKUP_BUFFER_MINUTES);
    }

    /**
     * Determines whether an NGO/volunteer can reach the donor before the batch expires.
     */
    public static boolean isPickupFeasible(double distanceKm, long minutesRemainingUntilExpiry) {
        if (minutesRemainingUntilExpiry <= 0) {
            return false;
        }
        int etaMinutes = estimateTravelTimeMinutes(distanceKm);
        return minutesRemainingUntilExpiry >= etaMinutes;
    }
}
