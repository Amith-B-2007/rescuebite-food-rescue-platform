package com.foodrescue.model;

import java.time.Instant;

/**
 * Represents a real-time alert dispatched to NGOs and volunteers
 * when a new surplus food batch is posted, enters a CRITICAL expiry window,
 * or transitions through pickup tracking stages.
 */
public class AlertEvent {

    private final String id;
    private final String batchId;
    private final String severity; // CRITICAL, URGENT, INFO, SUCCESS
    private final String title;
    private final String message;
    private final Instant timestamp;

    public AlertEvent(String id, String batchId, String severity, String title, String message, Instant timestamp) {
        this.id = id;
        this.batchId = batchId;
        this.severity = severity;
        this.title = title;
        this.message = message;
        this.timestamp = timestamp;
    }

    public String getId() { return id; }
    public String getBatchId() { return batchId; }
    public String getSeverity() { return severity; }
    public String getTitle() { return title; }
    public String getMessage() { return message; }
    public Instant getTimestamp() { return timestamp; }
}
