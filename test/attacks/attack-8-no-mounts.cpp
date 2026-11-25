#include <dirent.h>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <sys/stat.h>

static bool isAllowedMountPoint(const std::string& mp) {
    if (mp == "/" || mp == "/tmp" || mp == "/workspace" || mp == "/sbin/docker-init" ||
        mp == "/etc/hosts" || mp == "/etc/hostname" || mp == "/etc/resolv.conf") {
        return true;
    }
    if (mp == "/proc" || mp.rfind("/proc/", 0) == 0) return true;
    if (mp == "/sys" || mp.rfind("/sys/", 0) == 0) return true;
    if (mp == "/dev" || mp.rfind("/dev/", 0) == 0) return true;
    return false;
}

// Attack 8: Attempt to access host Docker socket or unexpected host mounts
int main() {
    struct stat st;
    if (stat("/var/run/docker.sock", &st) == 0 || stat("/run/docker.sock", &st) == 0) {
        std::cout << "BREACH: docker socket accessible!\n";
        return 42;
    }
    if (stat("/host", &st) == 0 || stat("/hostfs", &st) == 0) {
        std::cout << "BREACH: host filesystem mount found!\n";
        return 43;
    }
    if (DIR* rootDir = opendir("/root")) {
        closedir(rootDir);
        std::cout << "BREACH: host /root directory readable!\n";
        return 44;
    }

    std::ifstream mounts("/proc/mounts");
    std::string line;
    while (std::getline(mounts, line)) {
        if (line.find("docker.sock") != std::string::npos) {
            std::cout << "BREACH: docker socket mount found in /proc/mounts!\n";
            return 45;
        }
        std::istringstream iss(line);
        std::string dev, mp;
        if ((iss >> dev >> mp) && !isAllowedMountPoint(mp)) {
            std::cout << "BREACH: unexpected mount point " << mp << "\n";
            return 46;
        }
    }

    std::cerr << "docker socket and host mounts blocked\n";
    return 1;
}

