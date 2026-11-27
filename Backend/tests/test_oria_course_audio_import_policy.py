"""Tests purs hors réseau des chemins et plafonds d'import audio."""
from __future__ import annotations

import pytest

from app.repositories.supabase_course_audio_import_repository import (
    CourseAudioImportError, SupabaseCourseAudioImportRepository,
)


def test_import_path_is_scoped_to_owner_course_and_import():
    user = "11111111-1111-4111-8111-111111111111"
    course = "22222222-2222-4222-8222-222222222222"
    import_id = "33333333-3333-4333-8333-333333333333"
    assert SupabaseCourseAudioImportRepository._path(
        user_id=user, course_id=course, import_id=import_id, extension="m4a"
    ) == f"{user}/{course}/imports/{import_id}.m4a"


def test_import_path_rejects_unapproved_extension():
    with pytest.raises(CourseAudioImportError):
        SupabaseCourseAudioImportRepository._path(
            user_id="11111111-1111-4111-8111-111111111111",
            course_id="22222222-2222-4222-8222-222222222222",
            import_id="33333333-3333-4333-8333-333333333333",
            extension="exe",
        )


def test_import_source_limit_is_512_mib():
    assert SupabaseCourseAudioImportRepository.MAX_UPLOAD_BYTES == 512 * 1024 * 1024
