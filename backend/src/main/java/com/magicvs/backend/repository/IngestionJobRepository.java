package com.magicvs.backend.repository;

import com.magicvs.backend.model.IngestionJob;
import com.magicvs.backend.model.IngestionJobStatus;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface IngestionJobRepository extends JpaRepository<IngestionJob, UUID> {
    List<IngestionJob> findTop20ByStatusAndNextAttemptAtLessThanEqualOrderByNextAttemptAtAsc(
            IngestionJobStatus status,
            LocalDateTime nextAttemptAt);
}
