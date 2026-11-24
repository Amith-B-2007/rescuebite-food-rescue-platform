package com.foodrescue;

import com.foodrescue.model.AlertEvent;
import com.foodrescue.model.FoodBatch;
import com.foodrescue.service.ExpiryPriorityQueueService;
import com.foodrescue.util.DistanceCalculator;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Executors;

/**
 * Main Java HTTP & REST API Server for RescueBite:
 * Surplus Food Rescue & Redistribution Platform (SDG 2 & SDG 12).
 *
 * Powered by java.util.PriorityQueue<FoodBatch> and Haversine Distance Calculation.
 */
public class FoodRescueServer {

    private static final int PORT = 8080;
    private static final ExpiryPriorityQueueService queueService = new ExpiryPriorityQueueService();

    public static void main(String[] args) throws IOException {
        int port = PORT;
        if (args.length > 0) {
            try {
                port = Integer.parseInt(args[0]);
            } catch (NumberFormatException ignored) {}
        }

        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.setExecutor(Executors.newCachedThreadPool());

        // REST API Endpoints
        server.createContext("/api/state", FoodRescueServer::handleGetState);
        server.createContext("/api/batches", FoodRescueServer::handleCreateBatch);
        server.createContext("/api/batches/claim", FoodRescueServer::handleClaimBatch);
        server.createContext("/api/batches/status", FoodRescueServer::handleUpdateStatus);
        server.createContext("/api/simulate", FoodRescueServer::handleSimulateUrgentBatch);
        server.createContext("/api/ngos", FoodRescueServer::handleAddNgoHub);
        server.createContext("/api/export/csv", FoodRescueServer::handleExportCsv);

        // Static Web Assets
        server.createContext("/", FoodRescueServer::handleStaticFiles);

        server.start();
        System.out.println("====================================================================");
        System.out.println("  RescueBite - Surplus Food Rescue & Redistribution Platform");
        System.out.println("  SDGs: SDG 2 (Zero Hunger) & SDG 12 (Responsible Consumption)");
        System.out.println("  Java PriorityQueue Engine + Haversine Geo-Distance Server Active");
        System.out.println("  URL: http://localhost:" + port);
        System.out.println("====================================================================");
    }

    private static void handleGetState(HttpExchange exchange) throws IOException {
        addCorsHeaders(exchange);
        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            return;
        }

        Map<String, String> query = parseQueryParams(exchange.getRequestURI().getRawQuery());
        double ngoLat = parseDoubleOrDefault(query.get("ngoLat"), 12.9615);
        double ngoLon = parseDoubleOrDefault(query.get("ngoLon"), 77.6100);

        List<FoodBatch> orderedBatches = queueService.getBatchesInPriorityOrder();
        FoodBatch headBatch = queueService.peekMostUrgent();
        List<AlertEvent> alerts = queueService.getRecentAlerts();

        int activeCount = 0;
        int criticalCount = 0;
        int totalMealsRescued = 1280; // Historical baseline + live session
        double totalWeightRescuedKg = 435.0;
        int totalAvailableServings = 0;

        StringBuilder batchesJson = new StringBuilder("[");
        int priorityRank = 1;

        for (int i = 0; i < orderedBatches.size(); i++) {
            FoodBatch b = orderedBatches.get(i);
            double distanceKm = DistanceCalculator.calculateHaversineDistanceKm(
                    b.getLatitude(), b.getLongitude(), ngoLat, ngoLon
            );
            int etaMinutes = DistanceCalculator.estimateTravelTimeMinutes(distanceKm);
            long minsLeft = b.getMinutesUntilExpiry();
            boolean feasible = DistanceCalculator.isPickupFeasible(distanceKm, minsLeft);

            if ("AVAILABLE".equals(b.getStatus()) && minsLeft > 0) {
                activeCount++;
                totalAvailableServings += b.getServings();
                if (minsLeft <= 60) {
                    criticalCount++;
                }
            }
            if ("DELIVERED".equals(b.getStatus()) || "PICKED_UP".equals(b.getStatus())) {
                totalMealsRescued += b.getServings();
                totalWeightRescuedKg += b.getWeightKg();
            }

            int assignedRank = ("AVAILABLE".equals(b.getStatus()) && minsLeft > 0) ? (priorityRank++) : 0;

            if (i > 0) batchesJson.append(",");
            batchesJson.append(toBatchJson(b, assignedRank, distanceKm, etaMinutes, feasible));
        }
        batchesJson.append("]");

        StringBuilder alertsJson = new StringBuilder("[");
        for (int i = 0; i < alerts.size(); i++) {
            if (i > 0) alertsJson.append(",");
            alertsJson.append(toAlertJson(alerts.get(i)));
        }
        alertsJson.append("]");

        List<String[]> ngoHubsList = queueService.getNgoHubs();
        StringBuilder ngosJson = new StringBuilder("[");
        for (int i = 0; i < ngoHubsList.size(); i++) {
            String[] h = ngoHubsList.get(i);
            if (i > 0) ngosJson.append(",");
            ngosJson.append(String.format(Locale.US,
                    "{\"name\":%s,\"lat\":%s,\"lon\":%s,\"volunteer\":%s,\"phone\":%s}",
                    quote(h[0]), h[1], h[2], quote(h[3]), quote(h[4])
            ));
        }
        ngosJson.append("]");

        double co2PreventedKg = Math.round(totalWeightRescuedKg * 2.5 * 10.0) / 10.0;

        String responseJson = String.format(Locale.US,
                "{\"engine\":\"java.util.PriorityQueue<FoodBatch>\","
                        + "\"headBatchId\":%s,"
                        + "\"stats\":{\"activeBatches\":%d,\"criticalBatches\":%d,\"availableServings\":%d,"
                        + "\"mealsRescued\":%d,\"weightRescuedKg\":%.1f,\"co2PreventedKg\":%.1f},"
                        + "\"ngoHubs\":%s,"
                        + "\"batches\":%s,"
                        + "\"alerts\":%s}",
                headBatch != null ? quote(headBatch.getId()) : "null",
                activeCount,
                criticalCount,
                totalAvailableServings,
                totalMealsRescued,
                totalWeightRescuedKg,
                co2PreventedKg,
                ngosJson,
                batchesJson,
                alertsJson
        );

        sendJson(exchange, 200, responseJson);
    }

    private static void handleCreateBatch(HttpExchange exchange) throws IOException {
        addCorsHeaders(exchange);
        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            return;
        }
        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
            return;
        }

        String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        Map<String, String> payload = parseFlatJson(body);

        String donorName = payload.getOrDefault("donorName", "Community Partner Kitchen");
        String donorType = payload.getOrDefault("donorType", "RESTAURANT");
        String contactPhone = payload.getOrDefault("contactPhone", "+91 98450 00000");
        String foodTitle = payload.getOrDefault("foodTitle", "Fresh Cooked Surplus Meals");
        String category = payload.getOrDefault("category", "COOKED_MEALS");
        String dietaryType = payload.getOrDefault("dietaryType", "VEG");
        int servings = (int) parseDoubleOrDefault(payload.get("servings"), 50);
        double weightKg = parseDoubleOrDefault(payload.get("weightKg"), 18.0);
        int expiryMinutes = (int) parseDoubleOrDefault(payload.get("expiryMinutes"), 90);
        String pickupAddress = payload.getOrDefault("pickupAddress", "MG Road Central Pickup Point");
        double latitude = parseDoubleOrDefault(payload.get("latitude"), 12.9716);
        double longitude = parseDoubleOrDefault(payload.get("longitude"), 77.5946);
        String storageNotes = payload.getOrDefault("storageNotes", "Packed hygienically in food-grade containers.");

        FoodBatch created = queueService.addBatch(
                donorName, donorType, contactPhone, foodTitle, category, dietaryType,
                servings, weightKg, expiryMinutes, pickupAddress, latitude, longitude, storageNotes
        );

        sendJson(exchange, 201, "{\"status\":\"created\",\"batchId\":" + quote(created.getId()) + "}");
    }

    private static void handleClaimBatch(HttpExchange exchange) throws IOException {
        addCorsHeaders(exchange);
        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            return;
        }
        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
            return;
        }

        String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        Map<String, String> payload = parseFlatJson(body);

        String batchId = payload.get("batchId");
        String ngoName = payload.getOrDefault("ngoName", "Robin Hood Army");
        String volunteerName = payload.getOrDefault("volunteerName", "Rohan Verma");
        String volunteerPhone = payload.getOrDefault("volunteerPhone", "+91 98861 23456");

        try {
            FoodBatch updated = queueService.claimBatch(batchId, ngoName, volunteerName, volunteerPhone);
            sendJson(exchange, 200, "{\"status\":\"claimed\",\"batchId\":" + quote(updated.getId()) + "}");
        } catch (Exception e) {
            sendJson(exchange, 400, "{\"error\":" + quote(e.getMessage()) + "}");
        }
    }

    private static void handleUpdateStatus(HttpExchange exchange) throws IOException {
        addCorsHeaders(exchange);
        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            return;
        }
        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
            return;
        }

        String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        Map<String, String> payload = parseFlatJson(body);

        String batchId = payload.get("batchId");
        String nextStatus = payload.get("status");
        String enteredOtp = payload.get("otp");

        try {
            FoodBatch updated = queueService.updatePickupStatus(batchId, nextStatus, enteredOtp);
            sendJson(exchange, 200, "{\"status\":\"updated\",\"batchId\":" + quote(updated.getId()) + "}");
        } catch (Exception e) {
            sendJson(exchange, 400, "{\"error\":" + quote(e.getMessage()) + "}");
        }
    }

    private static void handleAddNgoHub(HttpExchange exchange) throws IOException {
        addCorsHeaders(exchange);
        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            return;
        }
        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendJson(exchange, 405, "{\"error\":\"Method not allowed\"}");
            return;
        }

        String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        Map<String, String> payload = parseFlatJson(body);

        String name = payload.getOrDefault("name", "Community Shelter Hub");
        double lat = parseDoubleOrDefault(payload.get("lat"), 12.9915);
        double lon = parseDoubleOrDefault(payload.get("lon"), 77.5521);
        String volunteer = payload.getOrDefault("volunteer", "Ananya Sharma");
        String phone = payload.getOrDefault("phone", "+91 98452 77889");

        queueService.addNgoHub(name, lat, lon, volunteer, phone);
        sendJson(exchange, 201, "{\"status\":\"created\",\"name\":" + quote(name) + "}");
    }

    private static void handleExportCsv(HttpExchange exchange) throws IOException {
        addCorsHeaders(exchange);
        List<FoodBatch> orderedBatches = queueService.getBatchesInPriorityOrder();
        StringBuilder csv = new StringBuilder();
        csv.append("Batch ID,PriorityQueue Rank,Urgency Level,Donor Organization,Donor Type,Food Description,Category,Dietary Type,Servings,Weight (kg),CO2 Prevented (kg),Remaining Expiry (mins),Pickup Address,Smart Auto-Match NGO,Status,Claimed By NGO,Volunteer Name,Volunteer Phone,Handover OTP,FSSAI Hygiene Verified\n");

        int rank = 1;
        for (FoodBatch b : orderedBatches) {
            int assignedRank = ("AVAILABLE".equals(b.getStatus()) && b.getMinutesUntilExpiry() > 0) ? (rank++) : 0;
            String[] bestMatch = queueService.findBestMatchedNgo(b);
            double co2Kg = Math.round(b.getWeightKg() * 2.5 * 10.0) / 10.0;

            csv.append(escapeCsv(b.getId())).append(",")
               .append(assignedRank > 0 ? "#" + assignedRank : "-").append(",")
               .append(escapeCsv(b.getUrgencyLevel())).append(",")
               .append(escapeCsv(b.getDonorName())).append(",")
               .append(escapeCsv(b.getDonorType())).append(",")
               .append(escapeCsv(b.getFoodTitle())).append(",")
               .append(escapeCsv(b.getCategory())).append(",")
               .append(escapeCsv(b.getDietaryType())).append(",")
               .append(b.getServings()).append(",")
               .append(String.format(Locale.US, "%.1f", b.getWeightKg())).append(",")
               .append(String.format(Locale.US, "%.1f", co2Kg)).append(",")
               .append(b.getMinutesUntilExpiry()).append(",")
               .append(escapeCsv(b.getPickupAddress())).append(",")
               .append(escapeCsv(bestMatch[0] + " (" + bestMatch[1] + " km)")).append(",")
               .append(escapeCsv(b.getStatus())).append(",")
               .append(escapeCsv(b.getClaimedByNgo() != null ? b.getClaimedByNgo() : "-")).append(",")
               .append(escapeCsv(b.getVolunteerName() != null ? b.getVolunteerName() : "-")).append(",")
               .append(escapeCsv(b.getVolunteerPhone() != null ? b.getVolunteerPhone() : "-")).append(",")
               .append(escapeCsv(b.getPickupOtp())).append(",")
               .append(b.isHygieneVerified() ? "YES" : "NO").append("\n");
        }

        byte[] bytes = csv.toString().getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "text/csv; charset=utf-8");
        exchange.getResponseHeaders().set("Content-Disposition", "attachment; filename=\"RescueBite_SDG_Impact_Report.csv\"");
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private static String escapeCsv(String val) {
        if (val == null) return "\"\"";
        return "\"" + val.replace("\"", "\"\"") + "\"";
    }

    private static void handleSimulateUrgentBatch(HttpExchange exchange) throws IOException {
        addCorsHeaders(exchange);
        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            return;
        }

        String[][] presets = {
                {"Taj Vivanta Banquet Hall", "EVENT_HALL", "Gala Dinner Surplus: Dum Biryani, Mirchi Ka Salan & Gulab Jamun", "EVENT_BUFFET", "VEG", "160", "54.0", "35", "Trinity Circle, MG Road", "12.9728", "77.6182"},
                {"BMS Engineering Hostel Mess", "HOSTEL", "Night Mess Surplus: 180 Phulkas, Chana Masala & Dal Fry", "COOKED_MEALS", "VEG", "95", "32.0", "48", "Bull Temple Road, Basavanagudi", "12.9410", "77.5655"},
                {"Empire Grill & Kitchen", "RESTAURANT", "Ghee Rice, Butter Chicken & Tandoori Roti Party Trays", "COOKED_MEALS", "NON_VEG", "75", "26.5", "40", "Church Street, Central", "12.9750", "77.6040"}
        };
        int idx = (int) (Math.random() * presets.length);
        String[] p = presets[idx];

        FoodBatch created = queueService.addBatch(
                p[0], p[1], "+91 98455 99887", p[2], p[3], p[4],
                Integer.parseInt(p[5]), Double.parseDouble(p[6]), Integer.parseInt(p[7]),
                p[8], Double.parseDouble(p[9]), Double.parseDouble(p[10]),
                "Flash alert batch! Hot-packed in insulated containers ready for immediate NGO pickup."
        );

        sendJson(exchange, 201, "{\"status\":\"simulated\",\"batchId\":" + quote(created.getId()) + "}");
    }

    private static void handleStaticFiles(HttpExchange exchange) throws IOException {
        String rawPath = exchange.getRequestURI().getPath();
        if (rawPath == null || rawPath.equals("/") || rawPath.isEmpty()) {
            rawPath = "/index.html";
        }
        if (rawPath.contains("..")) {
            exchange.sendResponseHeaders(403, -1);
            return;
        }

        Path staticRoot = Paths.get("src", "main", "resources", "static").toAbsolutePath();
        Path filePath = staticRoot.resolve(rawPath.substring(1)).normalize();

        if (!Files.exists(filePath) || Files.isDirectory(filePath)) {
            filePath = staticRoot.resolve("index.html");
        }

        if (!Files.exists(filePath)) {
            byte[] notFound = "404 Not Found".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(404, notFound.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(notFound);
            }
            return;
        }

        String contentType = getContentType(filePath.toString());
        byte[] bytes = Files.readAllBytes(filePath);
        exchange.getResponseHeaders().set("Content-Type", contentType);
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private static String getContentType(String filename) {
        if (filename.endsWith(".html")) return "text/html; charset=utf-8";
        if (filename.endsWith(".css")) return "text/css; charset=utf-8";
        if (filename.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (filename.endsWith(".json")) return "application/json; charset=utf-8";
        if (filename.endsWith(".svg")) return "image/svg+xml";
        if (filename.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    private static String toBatchJson(FoodBatch b, int queueRank, double distanceKm, int etaMinutes, boolean feasible) {
        String[] bestMatch = queueService.findBestMatchedNgo(b);
        return String.format(Locale.US,
                "{\"id\":%s,\"donorName\":%s,\"donorType\":%s,\"contactPhone\":%s,"
                        + "\"foodTitle\":%s,\"category\":%s,\"dietaryType\":%s,"
                        + "\"servings\":%d,\"weightKg\":%.1f,"
                        + "\"createdAtEpochMs\":%d,\"expiryEpochMs\":%d,"
                        + "\"minutesUntilExpiry\":%d,\"secondsUntilExpiry\":%d,"
                        + "\"urgencyLevel\":%s,\"priorityHeapKey\":%.2f,\"queueRank\":%d,"
                        + "\"pickupAddress\":%s,\"latitude\":%.5f,\"longitude\":%.5f,"
                        + "\"distanceKm\":%.2f,\"etaMinutes\":%d,\"feasible\":%b,"
                        + "\"storageNotes\":%s,\"status\":%s,"
                        + "\"pickupOtp\":%s,\"hygieneVerified\":%b,"
                        + "\"recommendedNgoName\":%s,\"recommendedNgoDistKm\":%s,\"recommendedNgoEtaMins\":%s,"
                        + "\"claimedByNgo\":%s,\"volunteerName\":%s,\"volunteerPhone\":%s}",
                quote(b.getId()),
                quote(b.getDonorName()),
                quote(b.getDonorType()),
                quote(b.getContactPhone()),
                quote(b.getFoodTitle()),
                quote(b.getCategory()),
                quote(b.getDietaryType()),
                b.getServings(),
                b.getWeightKg(),
                b.getCreatedAt().toEpochMilli(),
                b.getExpiryTime().toEpochMilli(),
                b.getMinutesUntilExpiry(),
                b.getSecondsUntilExpiry(),
                quote(b.getUrgencyLevel()),
                b.getPriorityHeapKey(),
                queueRank,
                quote(b.getPickupAddress()),
                b.getLatitude(),
                b.getLongitude(),
                distanceKm,
                etaMinutes,
                feasible,
                quote(b.getStorageNotes()),
                quote(b.getStatus()),
                quote(b.getPickupOtp()),
                b.isHygieneVerified(),
                quote(bestMatch[0]),
                bestMatch[1],
                bestMatch[2],
                quote(b.getClaimedByNgo()),
                quote(b.getVolunteerName()),
                quote(b.getVolunteerPhone())
        );
    }

    private static String toAlertJson(AlertEvent a) {
        return String.format(Locale.US,
                "{\"id\":%s,\"batchId\":%s,\"severity\":%s,\"title\":%s,\"message\":%s,\"timestampEpochMs\":%d}",
                quote(a.getId()),
                quote(a.getBatchId()),
                quote(a.getSeverity()),
                quote(a.getTitle()),
                quote(a.getMessage()),
                a.getTimestamp().toEpochMilli()
        );
    }

    private static String quote(String s) {
        if (s == null) return "null";
        String escaped = s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "");
        return "\"" + escaped + "\"";
    }

    private static void addCorsHeaders(HttpExchange exchange) {
        exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        exchange.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");
    }

    private static void sendJson(HttpExchange exchange, int statusCode, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(statusCode, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private static Map<String, String> parseQueryParams(String query) {
        Map<String, String> map = new HashMap<>();
        if (query == null || query.isEmpty()) return map;
        for (String pair : query.split("&")) {
            String[] kv = pair.split("=", 2);
            if (kv.length == 2) {
                map.put(URLDecoder.decode(kv[0], StandardCharsets.UTF_8),
                        URLDecoder.decode(kv[1], StandardCharsets.UTF_8));
            }
        }
        return map;
    }

    /**
     * Lightweight flat JSON object parser so no external dependencies are required.
     */
    private static Map<String, String> parseFlatJson(String json) {
        Map<String, String> map = new HashMap<>();
        if (json == null) return map;
        String trimmed = json.trim();
        if (trimmed.startsWith("{")) trimmed = trimmed.substring(1);
        if (trimmed.endsWith("}")) trimmed = trimmed.substring(0, trimmed.length() - 1);

        boolean inQuotes = false;
        StringBuilder token = new StringBuilder();
        for (int i = 0; i < trimmed.length(); i++) {
            char c = trimmed.charAt(i);
            if (c == '"' && (i == 0 || trimmed.charAt(i - 1) != '\\')) {
                inQuotes = !inQuotes;
            }
            if (c == ',' && !inQuotes) {
                putJsonPair(map, token.toString());
                token.setLength(0);
            } else {
                token.append(c);
            }
        }
        if (token.length() > 0) {
            putJsonPair(map, token.toString());
        }
        return map;
    }

    private static void putJsonPair(Map<String, String> map, String pair) {
        int colonIdx = pair.indexOf(':');
        if (colonIdx <= 0) return;
        String key = cleanJsonToken(pair.substring(0, colonIdx));
        String val = cleanJsonToken(pair.substring(colonIdx + 1));
        map.put(key, val);
    }

    private static String cleanJsonToken(String token) {
        String t = token.trim();
        if (t.startsWith("\"") && t.endsWith("\"") && t.length() >= 2) {
            t = t.substring(1, t.length() - 1);
        }
        return t.replace("\\\"", "\"").replace("\\\\", "\\");
    }

    private static double parseDoubleOrDefault(String val, double def) {
        if (val == null || val.isBlank()) return def;
        try {
            return Double.parseDouble(val.trim());
        } catch (NumberFormatException e) {
            return def;
        }
    }
}
