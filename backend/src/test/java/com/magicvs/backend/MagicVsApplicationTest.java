package com.magicvs.backend;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = "ingestion.initializer.enabled=false")
class MagicVsApplicationTest {

	@Test
	void contextLoads() {
	}

}
