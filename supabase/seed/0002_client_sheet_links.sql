-- Customer reports stored as .xlsx in Drive (not Google Sheets)
update public.clients c set customer_report_sheet_url = v.url from (values
('ifs', 'https://drive.google.com/file/d/1f65OaRmbg85df5yygG03iJyZDHKWFMFQ/view'),
('black-veatch', 'https://drive.google.com/file/d/1UlYr37p7Z_bQv1licXB-zb03AQeMIX5t/view'),
('franklin-energy', 'https://drive.google.com/file/d/1VACB59OBunc1kBmm1gQ4PwwM0TZEJ0dI/view'),
('locusview', 'https://docs.google.com/spreadsheets/d/13hU-BWToM1kZH9rwMyoDZWdAyqK55zFDaXTaRjBswCc/edit'),
('nv5', 'https://drive.google.com/file/d/1tKlS4oFZz8NK9-WN0q_IdIxYoe-pJz6G/view'),
('powerplan', 'https://drive.google.com/file/d/1NsIBnrKiCypLf-kWb0XqyzFpBib1uCPY/view'),
('trenwa', 'https://drive.google.com/file/d/1VCLjZBH3hOl0FCPR4H8E3gu4KZ8oyDOy/view'),
('uplight', 'https://drive.google.com/file/d/1tIf39E0ZddqOGZML_w1yvn-PK9cZjXnV/view'),
('cgi', 'https://drive.google.com/file/d/1yQ_jBvFpGmfUVHHvQRP3BKR4tAN1Xsnn/view'),
('ctc-global', 'https://drive.google.com/file/d/1yCFaWq6tDRvEF4fFqzjF4f3lB6IB2FDj/view')
) as v(slug, url) where c.slug = v.slug;

select count(*) as total, count(*) filter (where is_active) as live, count(*) filter (where customer_report_sheet_url is null) as no_sheet from public.clients;
