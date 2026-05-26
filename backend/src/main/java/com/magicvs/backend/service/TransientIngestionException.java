package com.magicvs.backend.service;

public class TransientIngestionException extends RuntimeException {

    public TransientIngestionException(String message, Throwable cause) {
        super(message, cause);
    }
}
