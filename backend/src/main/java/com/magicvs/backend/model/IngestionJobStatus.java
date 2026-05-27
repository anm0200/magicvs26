package com.magicvs.backend.model;

public enum IngestionJobStatus {
    PENDING,
    RUNNING,
    SUCCEEDED,
    RETRY_SCHEDULED,
    FAILED
}
