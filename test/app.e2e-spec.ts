import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './../src/app.module';

/**
 * End-to-end boot test.
 *
 * Skipped by default because it needs a reachable PostgreSQL database (the
 * AppModule connects on init). Remove `.skip` and point DATABASE_URL at a test
 * DB to run it locally / in CI.
 */
describe.skip('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  it('boots the application module', () => {
    expect(app).toBeDefined();
  });

  afterAll(async () => {
    await app?.close();
  });
});
