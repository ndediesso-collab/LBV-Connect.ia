from __future__ import annotations

import unittest

from app.services.prompt_service import (
    ORIA_TRANSCRIPTION_PROMPTS,
    build_course_section_messages,
    get_transcription_instructions,
)


class OriaTranscriptionProfileTests(unittest.TestCase):
    def test_four_document_profiles_are_registered(self):
        self.assertEqual(
            set(ORIA_TRANSCRIPTION_PROMPTS),
            {"course", "meeting", "speech", "interview"},
        )
        for document_type, prompt in ORIA_TRANSCRIPTION_PROMPTS.items():
            self.assertIsInstance(prompt, str)
            self.assertTrue(prompt.strip(), document_type)

    def test_legacy_default_remains_course(self):
        messages = build_course_section_messages(
            transcript="Contenu de test.", section_index=1, total_sections=1,
            output_format="html_fragment",
        )
        self.assertIn("ORIA COURS", messages[0]["content"])
        self.assertIn('class="oria-course-section"', messages[0]["content"])
        self.assertIn("Section 1/1", messages[1]["content"])

    def test_meeting_profile_is_used_for_meeting_documents(self):
        messages = build_course_section_messages(
            transcript="Nous validons le budget.", section_index=1,
            total_sections=1, course_title="Comité projet",
            output_format="html_fragment", document_type="meeting",
        )
        self.assertIn("COMPTE RENDU DE RÉUNION", messages[0]["content"])
        self.assertIn("COMPOSITION DOCUMENTAIRE CODE-FIRST", messages[0]["content"])
        self.assertIn("Réunion", messages[1]["content"])

    def test_speech_and_interview_profiles_are_distinct(self):
        speech = get_transcription_instructions("speech")
        interview = get_transcription_instructions("interview")
        self.assertIn("DISCOURS", speech)
        self.assertIn("ENTRETIEN ET INTERVIEW", interview)
        self.assertNotEqual(speech, interview)

    def test_unknown_profile_is_rejected(self):
        with self.assertRaises(ValueError):
            build_course_section_messages(
                transcript="Test", section_index=1, total_sections=1,
                document_type="podcast",
            )


if __name__ == "__main__":
    unittest.main()
