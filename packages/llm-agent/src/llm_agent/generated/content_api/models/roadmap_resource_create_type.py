from enum import StrEnum


class RoadmapResourceCreateType(StrEnum):
    BOOK = "book"
    GOOGLE_DRIVE = "google-drive"
    LINK = "link"
    PROJECT = "project"
    TEXT = "text"
    VIDEO = "video"
    YOUTUBE_PLAYLIST = "youtube-playlist"
    YOUTUBE_VIDEO = "youtube-video"

    def __str__(self) -> str:
        return str(self.value)
