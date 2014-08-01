.PHONY: keepright-tasks osmi-tasks

# need tigerdelta
	# import, tasks, backup
	# waiting for it to stabilize

install:
	sh install.sh
	sh import.keepright.sh
	sh import.osmi.sh

update:
	make update-keepright
	make update-osmi

tasks:
	make keepright-tasks
	make osmi-tasks
	make keepright-zip
	make osmi-zip

redis:
	wget http://download.redis.io/redis-stable.tar.gz
	tar xvzf redis-stable.tar.gz
	cd redis-stable
	make
	sudo redis-server
	# how am I going to run this as a service?

populate-tasks:
	sh populate-redis.sh

update-keepright:
	echo 'updating keepright'
	echo "DROP DATABASE keepright;" | psql -U postgres
	sh import.keepright.sh
	echo 'done updating keepright'

update-osmi:
	echo 'updating osmi'
	echo "DROP DATABASE osmi;" | psql -U postgres
	sh import.osmi.sh
	echo 'done updating osmi'

keepright-zip:
	sh s3.keepright.sh

osmi-zip:
	sh s3.osmi.sh

keepright-tasks:
	rm -rf keepright-tasks
	sh tasks.keepright.sh

osmi-tasks:
	rm -rf osmi-tasks
	sh tasks.osmi.sh

server:
	sudo ./node_modules/forever/bin/forever start index.js
