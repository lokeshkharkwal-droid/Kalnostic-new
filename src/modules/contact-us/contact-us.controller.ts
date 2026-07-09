import { Body, Controller, Post } from '@nestjs/common';
import { ContactUsService } from './contact-us.service';
import { CreateContactSubmissionDto } from './dto/create-contact-submission.dto';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Public contact-us form endpoint (`POST /contact-us`). `@Public()` opts the
 * route out of the global business `JwtAuthGuard` so anyone on the marketing
 * site can submit without authentication. No `@Audit` — there is no
 * authenticated actor/tenant on a public route (AuditLog is tenant-scoped).
 */
@Controller('contact-us')
export class ContactUsController {
  constructor(private readonly contactUsService: ContactUsService) {}

  /**
   * Submit a contact-us form.
   */
  @Public()
  @Post()
  submit(@Body() dto: CreateContactSubmissionDto) {
    return this.contactUsService.create(dto);
  }
}
