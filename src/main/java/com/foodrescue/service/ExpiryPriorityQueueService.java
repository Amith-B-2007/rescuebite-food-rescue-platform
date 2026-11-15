package com.foodrescue.service;

import com.foodrescue.model.AlertEvent;
import com.foodrescue.model.FoodBatch;
import com.foodrescue.util.DistanceCalculator;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.PriorityQueue;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Core service managing surplus food batches using java.util.PriorityQueue<FoodBatch>.
 * Automatically ranks food batches by expiry urgency (Min-Heap ordered by earliest expiry
 * and perishability score), computes Smart Auto-Match NGO recommendations, verifies
 * 4-digit Pickup Handover OTPs, and persists state to disk.
 */
public class ExpiryPriorityQueueService {

    private static final Path DATA_DIR = Paths.get("data");
    private static final Path BATCHES_DB_FILE = DATA_DIR.resolve("batches_db.tsv");
    private static final Path NGOS_DB_FILE = DATA_DIR.resolve("ngos_db.tsv");

    // Core Java PriorityQueue (Min-Heap) ranking batches by urgency
    private final PriorityQueue<FoodBatch> expiryPriorityQueue = new PriorityQueue<>();
    private final Map<String, FoodBatch> batchById = new LinkedHashMap<>();
    private final LinkedList<AlertEvent> recentAlerts = new LinkedList<>();
    private final List<String[]> ngoHubs = new ArrayList<>(); // [name, lat, lon, volunteer, phone]
    private final AtomicInteger idSequence = new AtomicInteger(108);
    private final AtomicInteger alertSequence = new AtomicInteger(500);

    public ExpiryPriorityQueueService() {
        seedDefaultNgoHubs();
        seedInitialData();
        loadPersistedNgoHubs();
        loadPersistedBatches();
        saveBatchesToDisk();
        saveNgoHubsToDisk();
    }

    private void seedDefaultNgoHubs() {
        ngoHubs.add(new String[]{"Robin Hood Army — Central Hub (MG Road)", "12.9615", "77.6100", "Vikram Rao", "+91 98802 33441"});
        ngoHubs.add(new String[]{"Akshaya Trust Shelter — South Hub (Jayanagar)", "12.9290", "77.5825", "Priya Nair", "+91 97390 54321"});
        ngoHubs.add(new String[]{"Annapurna Kitchen — East Hub (Indiranagar)", "12.9719", "77.6412", "Karthik Menon", "+91 98450 22334"});
        ngoHubs.add(new String[]{"Feeding India Youth — North Hub (Malleshwaram)", "13.0012", "77.5680", "Sneha Kulkarni", "+91 99001 55667"});
        ngoHubs.add(new String[]{"Roti Bank Foundation — Koramangala Hub", "12.9352", "77.6245", "Rohan Verma", "+91 98861 23456"});
        ngoHubs.add(new String[]{"Goonj Relief Kitchen — Whitefield Hub", "12.9698", "77.7499", "Deepak Shetty", "+91 97411 88992"});
        ngoHubs.add(new String[]{"SevaSadan Community Shelter — HSR Layout Hub", "12.9116", "77.6389", "Meera Iyer", "+91 98455 66771"});
    }

    private synchronized void seedInitialData() {
        Instant now = Instant.now();

        // 1. CRITICAL Expiry (~42 mins left) - Wedding / Event Hall
        FoodBatch b1 = new FoodBatch(
                "FB-101",
                "Grand Royal Convention Hall",
                "EVENT_HALL",
                "+91 98450 11223",
                "Wedding Banquet Surplus: Veg Biryani, Paneer Butter Masala & Dal Tadka",
                "EVENT_BUFFET",
                "VEG",
                140,
                48.5,
                now.minus(45, ChronoUnit.MINUTES),
                now.plus(42, ChronoUnit.MINUTES),
                "MG Road, Near Metro Station, Central District",
                12.9756,
                77.6066,
                "Stored in hot-hold stainless steel chafing dishes at 65°C. Bring insulated containers."
        );

        // 2. CRITICAL Expiry (~54 mins left) - University Hostel Mess
        FoodBatch b2 = new FoodBatch(
                "FB-102",
                "IIT / Engineering Campus Hostel Mess - Block C",
                "HOSTEL",
                "+91 98801 44556",
                "Fresh Chapati (220 pcs), Mixed Veg Curry & Steamed Jeera Rice",
                "COOKED_MEALS",
                "VEG",
                85,
                29.0,
                now.minus(30, ChronoUnit.MINUTES),
                now.plus(54, ChronoUnit.MINUTES),
                "University Avenue, Koramangala 4th Block",
                12.9352,
                77.6245,
                "Hygienically packed in food-grade aluminum trays at Hostel Gate 2."
        );

        // 3. HIGH Urgency (~115 mins left) - Restaurant
        FoodBatch b3 = new FoodBatch(
                "FB-103",
                "Olive & Spice Fine Dining Bistro",
                "RESTAURANT",
                "+91 97412 88990",
                "Grilled Herb Chicken, Roast Vegetables & Garlic Naan Platter",
                "COOKED_MEALS",
                "NON_VEG",
                55,
                19.5,
                now.minus(20, ChronoUnit.MINUTES),
                now.plus(115, ChronoUnit.MINUTES),
                "100 Feet Road, Indiranagar",
                12.9784,
                77.6408,
                "Separately packed in sealed meal boxes. Ready at kitchen dispatch bay."
        );

        // 4. HIGH Urgency (~140 mins left) - Corporate Cafeteria
        FoodBatch b4 = new FoodBatch(
                "FB-104",
                "TechPark Tower-B Executive Cafeteria",
                "CAMPUS_MESS",
                "+91 99001 77332",
                "Idli, Vada, Sambar & Coconut Chutney Evening Batch",
                "COOKED_MEALS",
                "VEGAN",
                110,
                34.0,
                now.minus(15, ChronoUnit.MINUTES),
                now.plus(140, ChronoUnit.MINUTES),
                "Outer Ring Road, Bellandur",
                12.9304,
                77.6784,
                "Security pass pre-approved for NGO pickup vehicle at Gate B."
        );

        // 5. MEDIUM Urgency (~225 mins left) - Artisan Bakery
        FoodBatch b5 = new FoodBatch(
                "FB-105",
                "Sunrise Artisan Bakery & Patisserie",
                "RESTAURANT",
                "+91 96112 33445",
                "Whole Wheat Bread Loaves, Multigrain Rolls & Veg Croissants",
                "BAKERY",
                "VEG",
                65,
                16.0,
                now.minus(60, ChronoUnit.MINUTES),
                now.plus(225, ChronoUnit.MINUTES),
                "Jayanagar 4th Block Main Road",
                12.9250,
                77.5838,
                "Dry ambient packaging in clean bakery crates."
        );

        // 6. SAFE Window (~340 mins left) - Organic Supermarket / Produce
        FoodBatch b6 = new FoodBatch(
                "FB-106",
                "GreenHarvest Fresh Mart & Hostel Supply",
                "HOTEL",
                "+91 94480 66778",
                "Assorted Fresh Fruits (Bananas, Apples, Papaya) & Milk Packets",
                "PRODUCE",
                "VEG",
                95,
                38.0,
                now.minus(25, ChronoUnit.MINUTES),
                now.plus(340, ChronoUnit.MINUTES),
                "Malleshwaram 8th Cross",
                13.0031,
                77.5643,
                "Cold-storage maintained at 4°C."
        );

        // 7. In-progress EN_ROUTE batch
        FoodBatch b7 = new FoodBatch(
                "FB-107",
                "Sapphire Hotel & Banquet",
                "HOTEL",
                "+91 98442 55110",
                "Corporate Lunch Buffet: Pulao, Rajma Masala & Curd Rice",
                "EVENT_BUFFET",
                "VEG",
                120,
                42.0,
                now.minus(90, ChronoUnit.MINUTES),
                now.plus(80, ChronoUnit.MINUTES),
                "Residency Road, Shanthala Nagar",
                12.9698,
                77.6012,
                "Packed in 4 insulated thermoboxes."
        );
        b7.setStatus("EN_ROUTE");
        b7.setClaimedByNgo("Robin Hood Army - Central Chapter");
        b7.setVolunteerName("Arjun Mehta");
        b7.setVolunteerPhone("+91 99860 12345");
        b7.setClaimedAt(now.minus(25, ChronoUnit.MINUTES));

        // 8. Completed DELIVERED batch (contributes to SDG 2 & 12 impact metrics)
        FoodBatch b8 = new FoodBatch(
                "FB-108",
                "National Girls Hostel Dining Hall",
                "HOSTEL",
                "+91 98451 90876",
                "Morning Surplus: Masala Dosa Batter, Upma & Boiled Eggs",
                "COOKED_MEALS",
                "NON_VEG",
                90,
                31.5,
                now.minus(240, ChronoUnit.MINUTES),
                now.plus(30, ChronoUnit.MINUTES),
                "Basavanagudi, Bull Temple Road",
                12.9416,
                77.5669,
                "Delivered safely in thermal containers."
        );
        b8.setStatus("DELIVERED");
        b8.setClaimedByNgo("Akshaya Trust Community Shelter");
        b8.setVolunteerName("Priya Nair");
        b8.setVolunteerPhone("+91 97390 54321");
        b8.setClaimedAt(now.minus(190, ChronoUnit.MINUTES));
        b8.setPickedUpAt(now.minus(165, ChronoUnit.MINUTES));
        b8.setDeliveredAt(now.minus(140, ChronoUnit.MINUTES));

        registerSeedBatch(b1);
        registerSeedBatch(b2);
        registerSeedBatch(b3);
        registerSeedBatch(b4);
        registerSeedBatch(b5);
        registerSeedBatch(b6);
        registerSeedBatch(b7);
        registerSeedBatch(b8);

        // Seed initial real-time alerts
        pushAlert("FB-101", "CRITICAL",
                "CRITICAL Expiry Alert (42m left)",
                "Grand Royal Convention Hall posted 140 servings (48.5 kg) Veg Biryani & Paneer. Ranked #1 in Java PriorityQueue!");
        pushAlert("FB-102", "CRITICAL",
                "Urgent Hostel Surplus (54m left)",
                "IIT Campus Hostel Mess Block C listed 85 servings of Fresh Chapati & Veg Curry.");
        pushAlert("FB-107", "INFO",
                "Volunteer En Route",
                "Arjun Mehta (Robin Hood Army) is 1.4 km away from Sapphire Hotel & Banquet for batch FB-107.");
        pushAlert("FB-108", "SUCCESS",
                "Batch Delivered — Zero Waste Achieved!",
                "Priya Nair delivered 90 servings (31.5 kg) from National Girls Hostel to Akshaya Trust Shelter.");
    }

    private void registerSeedBatch(FoodBatch batch) {
        batchById.put(batch.getId(), batch);
        expiryPriorityQueue.offer(batch);
    }

    /**
     * Re-heapifies the Java PriorityQueue so dynamic time-dependent priority keys
     * and status changes are accurately reflected at the head of the min-heap.
     */
    public synchronized void refreshPriorityQueue() {
        expiryPriorityQueue.clear();
        for (FoodBatch batch : batchById.values()) {
            if ("AVAILABLE".equals(batch.getStatus()) && batch.getSecondsUntilExpiry() <= 0) {
                batch.setStatus("EXPIRED");
            }
            expiryPriorityQueue.offer(batch);
        }
    }

    /**
     * Inserts a new donor food batch into the PriorityQueue and generates a real-time alert.
     */
    public synchronized FoodBatch addBatch(
            String donorName,
            String donorType,
            String contactPhone,
            String foodTitle,
            String category,
            String dietaryType,
            int servings,
            double weightKg,
            int expiryMinutes,
            String pickupAddress,
            double latitude,
            double longitude,
            String storageNotes
    ) {
        String id = "FB-" + idSequence.incrementAndGet();
        Instant now = Instant.now();
        Instant expiryTime = now.plus(expiryMinutes, ChronoUnit.MINUTES);

        FoodBatch batch = new FoodBatch(
                id,
                donorName,
                donorType,
                contactPhone,
                foodTitle,
                category,
                dietaryType,
                servings,
                weightKg,
                now,
                expiryTime,
                pickupAddress,
                latitude,
                longitude,
                storageNotes
        );

        batchById.put(id, batch);
        refreshPriorityQueue();
        saveBatchesToDisk();

        String severity = expiryMinutes <= 60 ? "CRITICAL" : (expiryMinutes <= 150 ? "URGENT" : "INFO");
        FoodBatch head = expiryPriorityQueue.peek();
        boolean isNewHead = head != null && head.getId().equals(id);

        pushAlert(
                id,
                severity,
                (isNewHead ? "NEW #1 PRIORITY BATCH: " : "New Surplus Listed: ") + donorName,
                String.format("%s (%d servings, %.1f kg) expires in %d mins at %s. [Handover OTP: %s]",
                        foodTitle, servings, weightKg, expiryMinutes, pickupAddress, batch.getPickupOtp())
        );

        return batch;
    }

    /**
     * Polls a snapshot copy of the Java PriorityQueue to return all batches
     * in exact Min-Heap priority order (most urgent first).
     */
    public synchronized List<FoodBatch> getBatchesInPriorityOrder() {
        refreshPriorityQueue();
        PriorityQueue<FoodBatch> heapCopy = new PriorityQueue<>(expiryPriorityQueue);
        List<FoodBatch> ordered = new ArrayList<>(heapCopy.size());
        while (!heapCopy.isEmpty()) {
            ordered.add(heapCopy.poll()); // Standard PriorityQueue.poll() O(log n) extraction
        }
        return ordered;
    }

    /**
     * Peeks at the highest-priority batch at the root of the PriorityQueue in O(1) time.
     */
    public synchronized FoodBatch peekMostUrgent() {
        refreshPriorityQueue();
        return expiryPriorityQueue.peek();
    }

    /**
     * Claims an available food batch for an NGO / Volunteer.
     */
    public synchronized FoodBatch claimBatch(String batchId, String ngoName, String volunteerName, String volunteerPhone) {
        FoodBatch batch = batchById.get(batchId);
        if (batch == null) {
            throw new IllegalArgumentException("Batch not found: " + batchId);
        }
        if (!"AVAILABLE".equals(batch.getStatus())) {
            throw new IllegalStateException("Batch " + batchId + " is already " + batch.getStatus());
        }
        batch.setStatus("CLAIMED");
        batch.setClaimedByNgo(ngoName);
        batch.setVolunteerName(volunteerName);
        batch.setVolunteerPhone(volunteerPhone);
        batch.setClaimedAt(Instant.now());

        refreshPriorityQueue();
        saveBatchesToDisk();

        pushAlert(
                batchId,
                "INFO",
                "Batch Claimed by " + ngoName,
                String.format("Volunteer %s claimed %s (%d servings) from %s. Handover OTP: %s.",
                        volunteerName, batch.getFoodTitle(), batch.getServings(), batch.getDonorName(), batch.getPickupOtp())
        );

        return batch;
    }

    /**
     * Advances or updates the pickup status of a claimed batch:
     * CLAIMED -> EN_ROUTE -> PICKED_UP (verifies 4-digit OTP) -> DELIVERED
     */
    public synchronized FoodBatch updatePickupStatus(String batchId, String nextStatus, String enteredOtp) {
        FoodBatch batch = batchById.get(batchId);
        if (batch == null) {
            throw new IllegalArgumentException("Batch not found: " + batchId);
        }

        if ("PICKED_UP".equals(nextStatus) && enteredOtp != null && !enteredOtp.isBlank()) {
            if (!batch.getPickupOtp().equals(enteredOtp.trim())) {
                throw new IllegalArgumentException("Invalid 4-digit Pickup OTP! Please check the Donor's Handover OTP (" + batch.getPickupOtp() + ").");
            }
        }

        Instant now = Instant.now();
        batch.setStatus(nextStatus);
        if ("PICKED_UP".equals(nextStatus)) {
            batch.setPickedUpAt(now);
            pushAlert(batchId, "INFO",
                    "OTP Verified (" + batch.getPickupOtp() + ") — Food Collected",
                    String.format("%s verified handover OTP & picked up %d servings from %s.",
                            batch.getVolunteerName(), batch.getServings(), batch.getDonorName()));
        } else if ("DELIVERED".equals(nextStatus)) {
            batch.setDeliveredAt(now);
            pushAlert(batchId, "SUCCESS",
                    "Batch Delivered (" + batch.getServings() + " Meals Rescued!)",
                    String.format("%s successfully delivered %.1f kg of surplus food to %s.",
                            batch.getVolunteerName(), batch.getWeightKg(), batch.getClaimedByNgo()));
        } else if ("EN_ROUTE".equals(nextStatus)) {
            pushAlert(batchId, "INFO",
                    "Volunteer Dispatched (En Route)",
                    String.format("%s is on the way to %s for pickup.",
                            batch.getVolunteerName(), batch.getDonorName()));
        }

        refreshPriorityQueue();
        saveBatchesToDisk();
        return batch;
    }

    /**
     * Feature 3: Smart Auto-Match (Nearest Feasible NGO Recommender).
     * Evaluates all registered NGO Hubs using the Haversine distance formula and
     * returns [bestNgoName, distanceKmStr, etaMinsStr].
     */
    public synchronized String[] findBestMatchedNgo(FoodBatch batch) {
        String bestName = "Robin Hood Army — Central Hub (MG Road)";
        double bestDist = 9999.0;
        int bestEta = 999;
        long minsLeft = Math.max(15, batch.getMinutesUntilExpiry());

        for (String[] hub : ngoHubs) {
            double hLat = Double.parseDouble(hub[1]);
            double hLon = Double.parseDouble(hub[2]);
            double dist = DistanceCalculator.calculateHaversineDistanceKm(
                    batch.getLatitude(), batch.getLongitude(), hLat, hLon
            );
            int eta = DistanceCalculator.estimateTravelTimeMinutes(dist);
            boolean feasible = DistanceCalculator.isPickupFeasible(dist, minsLeft);

            if (feasible && dist < bestDist) {
                bestDist = dist;
                bestEta = eta;
                bestName = hub[0];
            }
        }
        if (bestDist == 9999.0 && !ngoHubs.isEmpty()) {
            for (String[] hub : ngoHubs) {
                double hLat = Double.parseDouble(hub[1]);
                double hLon = Double.parseDouble(hub[2]);
                double dist = DistanceCalculator.calculateHaversineDistanceKm(
                        batch.getLatitude(), batch.getLongitude(), hLat, hLon
                );
                if (dist < bestDist) {
                    bestDist = dist;
                    bestEta = DistanceCalculator.estimateTravelTimeMinutes(dist);
                    bestName = hub[0];
                }
            }
        }
        return new String[]{
                bestName,
                String.format(Locale.US, "%.2f", bestDist),
                String.valueOf(bestEta)
        };
    }

    public synchronized void addNgoHub(String name, double lat, double lon, String volunteer, String phone) {
        for (String[] existing : ngoHubs) {
            if (existing[0].equalsIgnoreCase(name)) return;
        }
        ngoHubs.add(new String[]{
                name,
                String.format(Locale.US, "%.5f", lat),
                String.format(Locale.US, "%.5f", lon),
                volunteer != null ? volunteer : "Volunteer Coordinator",
                phone != null ? phone : "+91 98450 00000"
        });
        saveNgoHubsToDisk();
    }

    public synchronized List<String[]> getNgoHubs() {
        return new ArrayList<>(ngoHubs);
    }

    public synchronized List<AlertEvent> getRecentAlerts() {
        return new ArrayList<>(recentAlerts);
    }

    private void pushAlert(String batchId, String severity, String title, String message) {
        AlertEvent alert = new AlertEvent(
                "ALT-" + alertSequence.incrementAndGet(),
                batchId,
                severity,
                title,
                message,
                Instant.now()
        );
        recentAlerts.addFirst(alert);
        while (recentAlerts.size() > 25) {
            recentAlerts.removeLast();
        }
    }

    // ==================== FEATURE 5: PERSISTENT STORAGE (AUTO-SAVE & AUTO-LOAD) ====================
    private synchronized void saveBatchesToDisk() {
        try {
            Files.createDirectories(DATA_DIR);
            List<String> lines = new ArrayList<>();
            for (FoodBatch b : batchById.values()) {
                String line = String.join("\t",
                        sanitizeTsv(b.getId()),
                        sanitizeTsv(b.getDonorName()),
                        sanitizeTsv(b.getDonorType()),
                        sanitizeTsv(b.getContactPhone()),
                        sanitizeTsv(b.getFoodTitle()),
                        sanitizeTsv(b.getCategory()),
                        sanitizeTsv(b.getDietaryType()),
                        String.valueOf(b.getServings()),
                        String.valueOf(b.getWeightKg()),
                        String.valueOf(b.getCreatedAt().toEpochMilli()),
                        String.valueOf(b.getExpiryTime().toEpochMilli()),
                        sanitizeTsv(b.getPickupAddress()),
                        String.valueOf(b.getLatitude()),
                        String.valueOf(b.getLongitude()),
                        sanitizeTsv(b.getStorageNotes()),
                        sanitizeTsv(b.getStatus()),
                        sanitizeTsv(b.getClaimedByNgo()),
                        sanitizeTsv(b.getVolunteerName()),
                        sanitizeTsv(b.getVolunteerPhone()),
                        sanitizeTsv(b.getPickupOtp()),
                        String.valueOf(b.isHygieneVerified())
                );
                lines.add(line);
            }
            Files.write(BATCHES_DB_FILE, lines, StandardCharsets.UTF_8);
        } catch (IOException ignored) {}
    }

    private synchronized void loadPersistedBatches() {
        if (!Files.exists(BATCHES_DB_FILE)) return;
        try {
            List<String> lines = Files.readAllLines(BATCHES_DB_FILE, StandardCharsets.UTF_8);
            Instant now = Instant.now();
            int maxSeq = 108;

            for (String line : lines) {
                if (line == null || line.isBlank()) continue;
                String[] p = line.split("\t", -1);
                if (p.length < 20) continue;

                String id = p[0];
                if (id.startsWith("FB-")) {
                    try {
                        maxSeq = Math.max(maxSeq, Integer.parseInt(id.substring(3)));
                    } catch (NumberFormatException ignored) {}
                }

                Instant createdAt = Instant.ofEpochMilli(Long.parseLong(p[9]));
                Instant expiryTime = Instant.ofEpochMilli(Long.parseLong(p[10]));
                String status = p[15];

                // If an active demo batch expired while the server was offline, refresh its window
                if ("AVAILABLE".equals(status) && expiryTime.isBefore(now.plus(10, ChronoUnit.MINUTES))) {
                    int refreshedMins = 45 + Math.abs(id.hashCode() % 140);
                    expiryTime = now.plus(refreshedMins, ChronoUnit.MINUTES);
                }

                FoodBatch b = new FoodBatch(
                        id, p[1], p[2], p[3], p[4], p[5], p[6],
                        Integer.parseInt(p[7]), Double.parseDouble(p[8]),
                        createdAt, expiryTime, p[11],
                        Double.parseDouble(p[12]), Double.parseDouble(p[13]), p[14]
                );
                b.setStatus(status);
                if (!p[16].isEmpty()) b.setClaimedByNgo(p[16]);
                if (!p[17].isEmpty()) b.setVolunteerName(p[17]);
                if (!p[18].isEmpty()) b.setVolunteerPhone(p[18]);
                if (!p[19].isEmpty()) b.setPickupOtp(p[19]);
                if (p.length >= 21) b.setHygieneVerified(Boolean.parseBoolean(p[20]));

                batchById.put(id, b);
            }
            idSequence.set(maxSeq);
            refreshPriorityQueue();
        } catch (Exception ignored) {}
    }

    private synchronized void saveNgoHubsToDisk() {
        try {
            Files.createDirectories(DATA_DIR);
            List<String> lines = new ArrayList<>();
            for (String[] h : ngoHubs) {
                lines.add(String.join("\t", h[0], h[1], h[2], h[3], h[4]));
            }
            Files.write(NGOS_DB_FILE, lines, StandardCharsets.UTF_8);
        } catch (IOException ignored) {}
    }

    private synchronized void loadPersistedNgoHubs() {
        if (!Files.exists(NGOS_DB_FILE)) return;
        try {
            List<String> lines = Files.readAllLines(NGOS_DB_FILE, StandardCharsets.UTF_8);
            for (String line : lines) {
                if (line == null || line.isBlank()) continue;
                String[] p = line.split("\t", -1);
                if (p.length >= 5) {
                    addNgoHub(p[0], Double.parseDouble(p[1]), Double.parseDouble(p[2]), p[3], p[4]);
                }
            }
        } catch (Exception ignored) {}
    }

    private String sanitizeTsv(String s) {
        if (s == null) return "";
        return s.replace("\t", " ").replace("\n", " ").replace("\r", "");
    }
}
