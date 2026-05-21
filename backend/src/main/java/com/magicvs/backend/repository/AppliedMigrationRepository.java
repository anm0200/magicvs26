package com.magicvs.backend.repository;
import com.magicvs.backend.model.AppliedMigration;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.UUID;

@Repository
public interface AppliedMigrationRepository extends JpaRepository<AppliedMigration, UUID> {
}
